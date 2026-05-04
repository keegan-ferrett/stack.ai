import { useMemo, useRef, useState } from "react";
import {
	Box,
	render,
	Text,
	useApp,
	useBoxMetrics,
	useInput,
	usePaste,
	useWindowSize,
	type DOMElement,
} from "ink";
import {
	createAnthropic,
	type Message,
	type Provider,
} from "@kstack/chat";
import {
	coreTools,
	runAgenticTurn,
	type Tool,
	type ToolResult,
} from "@kstack/agent";
import {
	parseCommand,
	type Command,
	type CommandHost,
	type OverlayRender,
} from "./commands.ts";
import { compileMarkdown } from "./system-prompt.ts";

const MODEL = "claude-haiku-4-5";

const CAT_ART = [
	" /\\_/\\",
	"( o.o )",
	" > ^ <",
].join("\n");

const CAT_ART_GALLERY = [
	"   /\\_/\\        /\\_/\\        /\\_/\\",
	"  ( o.o )      ( -.- )      ( ^.^ )",
	"   > ^ <        > ~ <        > w <",
	"",
	"  curious      sleepy       happy",
].join("\n");

type TextEntry = {
	kind: "text";
	role: "user" | "assistant" | "system";
	text: string;
	isError?: boolean;
};

type ToolEntry = {
	kind: "tool";
	id: string;
	tool: Tool;
	input: unknown;
	result?: ToolResult;
};

type Entry = TextEntry | ToolEntry;

type ProviderState =
	| { ok: true; provider: Provider }
	| { ok: false; error: string };

const providerState: ProviderState = (() => {
	if (!process.env.ANTHROPIC_API_KEY) {
		return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
	}
	try {
		return { ok: true, provider: createAnthropic() };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
})();

/**
 * System prompt shipped with the TUI. Loaded once at startup from SYSTEM.md
 * next to this entry file, with `@path/to/file.md` includes expanded relative
 * to each containing file. Missing/empty SYSTEM.md means no system prompt.
 */
const systemPrompt: string | undefined = await (async () => {
	const path = `${import.meta.dir}/SYSTEM.md`;
	if (!(await Bun.file(path).exists())) return undefined;
	const compiled = (await compileMarkdown(path)).trim();
	return compiled.length > 0 ? compiled : undefined;
})();

type HeaderProps = {
	title: string;
	subtitle?: string;
};

const Header = ({ title, subtitle }: HeaderProps) => (
	<Box
		borderStyle="round"
		borderColor="cyan"
		paddingX={1}
		flexDirection="column"
	>
		<Text bold color="cyan">
			{title}
		</Text>
		{subtitle ? <Text dimColor>{subtitle}</Text> : null}
	</Box>
);

type TextInputProps = {
	placeholder?: string;
	disabled?: boolean;
	onSubmit: (value: string) => void;
};

const TextInput = ({
	placeholder = "",
	disabled = false,
	onSubmit,
}: TextInputProps) => {
	const [value, setValue] = useState("");

	useInput(
		(input, key) => {
			if (key.return) {
				onSubmit(value);
				setValue("");
				return;
			}

			if (key.backspace || key.delete) {
				setValue((previous) => previous.slice(0, -1));
				return;
			}

			if (
				key.ctrl ||
				key.meta ||
				key.escape ||
				key.tab ||
				key.upArrow ||
				key.downArrow ||
				key.leftArrow ||
				key.rightArrow ||
				key.pageUp ||
				key.pageDown ||
				key.home ||
				key.end ||
				!input
			) {
				return;
			}

			setValue((previous) => previous + input);
		},
		{ isActive: !disabled },
	);

	usePaste((text) => {
		if (!disabled) setValue((previous) => previous + text);
	});

	return (
		<Text>
			{value.length > 0 ? value : <Text dimColor>{placeholder}</Text>}
			<Text inverse> </Text>
		</Text>
	);
};

type HistoryViewProps = {
	entries: Entry[];
};

const PREFIX_WIDTH = 2;

type VisualLine =
	| { kind: "text"; entry: TextEntry; text: string; isFirst: boolean }
	| { kind: "tool"; entry: ToolEntry };

/**
 * Tool entries are treated as opaque single-slot blocks for scroll accounting.
 * Their views may visually span multiple terminal rows; in that case the
 * line-based scroll math is approximate. Acceptable trade-off for now —
 * exact measurement is a follow-up.
 */
function flattenEntries(entries: Entry[], width: number): VisualLine[] {
	const wrapWidth = Math.max(1, width - PREFIX_WIDTH);
	const lines: VisualLine[] = [];

	for (const entry of entries) {
		if (entry.kind === "tool") {
			lines.push({ kind: "tool", entry });
			continue;
		}

		const display =
			entry.text.length > 0
				? entry.text
				: entry.role === "assistant" && !entry.isError
					? "…"
					: "";
		const paragraphs = display.split("\n");
		let isFirst = true;

		for (const paragraph of paragraphs) {
			if (paragraph.length === 0) {
				lines.push({ kind: "text", entry, text: "", isFirst });
				isFirst = false;
				continue;
			}
			for (let pos = 0; pos < paragraph.length; pos += wrapWidth) {
				lines.push({
					kind: "text",
					entry,
					text: paragraph.slice(pos, pos + wrapWidth),
					isFirst,
				});
				isFirst = false;
			}
		}
	}

	return lines;
}

const HistoryView = ({ entries }: HistoryViewProps) => {
	const ref = useRef<DOMElement>(null);
	const { width, height, hasMeasured } = useBoxMetrics(
		ref as React.RefObject<DOMElement>,
	);
	const [offset, setOffset] = useState(0);

	const lines = hasMeasured ? flattenEntries(entries, width) : [];
	const maxOffset = Math.max(0, lines.length - height);
	const clampedOffset = Math.min(offset, maxOffset);

	useInput((_input, key) => {
		if (key.upArrow) {
			setOffset((previous) => Math.min(previous + 1, maxOffset));
		} else if (key.downArrow) {
			setOffset((previous) => Math.max(0, previous - 1));
		}
	});

	const end = lines.length - clampedOffset;
	const start = Math.max(0, end - height);
	const visible = lines.slice(start, end);

	return (
		<Box ref={ref} flexGrow={1} flexDirection="column" justifyContent="flex-end">
			{visible.map((line, index) =>
				line.kind === "tool" ? (
					<ToolEntryRow key={start + index} entry={line.entry} />
				) : (
					<VisualLineRow key={start + index} line={line} />
				),
			)}
		</Box>
	);
};

const VisualLineRow = ({
	line,
}: {
	line: Extract<VisualLine, { kind: "text" }>;
}) => {
	const { entry, text, isFirst } = line;
	if (!isFirst) {
		return (
			<Text>
				<Text>{"  "}</Text>
				<Text color={entry.isError ? "red" : undefined}>{text}</Text>
			</Text>
		);
	}
	if (entry.role === "user") {
		return (
			<Text>
				<Text color="green">› </Text>
				<Text>{text}</Text>
			</Text>
		);
	}
	if (entry.isError) {
		return (
			<Text>
				<Text color="red">✗ </Text>
				<Text color="red">{text}</Text>
			</Text>
		);
	}
	if (entry.role === "system") {
		return (
			<Text>
				<Text dimColor>• </Text>
				<Text dimColor>{text}</Text>
			</Text>
		);
	}
	return (
		<Text>
			<Text color="cyan">‹ </Text>
			{text === "…" ? <Text dimColor>{text}</Text> : <Text>{text}</Text>}
		</Text>
	);
};

/**
 * Renders a tool turn inline in the chat history. The TUI owns the
 * "→ <name>" header so individual tools never have to print their own name;
 * the body is whatever the tool's `view` returns, or a default text rendering
 * of `result.content` if no view is provided.
 */
const ToolEntryRow = ({ entry }: { entry: ToolEntry }) => {
	const view = entry.tool.view;
	return (
		<Box flexDirection="column">
			<Text>
				<Text color="magenta">→ </Text>
				<Text color="magenta">{entry.tool.name}</Text>
			</Text>
			<Box paddingLeft={2}>
				{view ? (
					view({ input: entry.input, result: entry.result })
				) : (
					<Text dimColor={!entry.result}>
						{entry.result ? entry.result.content : "(running…)"}
					</Text>
				)}
			</Box>
		</Box>
	);
};

/**
 * Chrome around an overlay view opened via `CommandHost.openView`. Sits in the
 * input bar's slot at the bottom of the screen — history stays visible above —
 * and prints the dismissal hint so individual views don't have to. Esc
 * handling lives on `App` so it works regardless of whether the inner view
 * consumes input.
 */
const OverlayPane = ({ children }: { children: React.ReactNode }) => (
	<Box flexDirection="column">
		{children}
		<Box paddingX={1}>
			<Text dimColor>esc to close</Text>
		</Box>
	</Box>
);

type AppProps = {
	externalCommands?: readonly Command[];
	externalTools?: readonly Tool[];
};

const App = ({
	externalCommands = [],
	externalTools = [],
}: AppProps) => {
	const { exit } = useApp();
	const { rows } = useWindowSize();
	const [entries, setEntries] = useState<Entry[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [overlay, setOverlay] = useState<OverlayRender | null>(null);

	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			exit();
			return;
		}
		if (key.escape && overlay) {
			setOverlay(null);
		}
	});

	const host = useMemo<CommandHost>(
		() => ({
			print: (text, opts) =>
				setEntries((previous) => [
					...previous,
					{ kind: "text", role: "system", text, isError: opts?.isError },
				]),
			// Wrap in an updater so React doesn't invoke `render` as a state-updater
			// fn — `OverlayRender` is itself a function value.
			openView: (render) => setOverlay(() => render),
		}),
		[],
	);

	const allTools = useMemo<readonly Tool[]>(
		() => [...coreTools, ...externalTools],
		[externalTools],
	);

	const registry = useMemo<readonly Command[]>(() => {
		const internal: Command[] = [
			{
				name: "clear",
				description: "Clear chat history",
				run: () => setEntries([]),
			},
			{
				name: "exit",
				description: "Exit the TUI",
				run: () => exit(),
			},
			{
				name: "cat",
				description: "Print an ASCII cat",
				run: (_args, h) => h.print(CAT_ART),
			},
			{
				name: "cat-art",
				description: "Open a cat art view (esc to close)",
				run: () =>
					setOverlay(() => () => (
						<Box
							borderStyle="round"
							borderColor="magenta"
							paddingX={2}
							paddingY={1}
							flexDirection="column"
							alignItems="center"
						>
							<Text bold color="magenta">
								cat art gallery
							</Text>
							<Box marginTop={1}>
								<Text>{CAT_ART_GALLERY}</Text>
							</Box>
						</Box>
					)),
			},
		];
		const all: Command[] = [...internal, ...externalCommands];
		const help: Command = {
			name: "help",
			description: "List available commands",
			run: (_args, h) => {
				const lines = [help, ...all].map(
					(c) => `/${c.name} — ${c.description}`,
				);
				h.print(lines.join("\n"));
			},
		};
		return [help, ...all];
	}, [externalCommands, exit]);

	const handleSubmit = async (input: string) => {
		if (input.length === 0 || isStreaming) return;

		const parsed = parseCommand(input, registry);

		if (parsed.kind === "command") {
			setEntries((previous) => [
				...previous,
				{ kind: "text", role: "user", text: input },
			]);
			try {
				await parsed.command.run(parsed.args, host);
			} catch (error) {
				host.print(error instanceof Error ? error.message : String(error), {
					isError: true,
				});
			}
			return;
		}

		if (parsed.kind === "unknown") {
			setEntries((previous) => [
				...previous,
				{ kind: "text", role: "user", text: input },
				{
					kind: "text",
					role: "system",
					text: `Unknown command: /${parsed.name}. Try /help.`,
					isError: true,
				},
			]);
			return;
		}

		if (!providerState.ok) return;

		const userEntry: TextEntry = { kind: "text", role: "user", text: input };
		const apiMessages: Message[] = [...entries, userEntry].flatMap((entry) => {
			if (entry.kind !== "text") return [];
			if (entry.role === "system") return [];
			return [{ role: entry.role, content: entry.text }];
		});

		setEntries((previous) => [...previous, userEntry]);
		setIsStreaming(true);

		try {
			for await (const event of runAgenticTurn(
				providerState.provider,
				{ model: MODEL, system: systemPrompt, messages: apiMessages },
				allTools,
			)) {
				if (event.type === "text_delta") {
					const text = event.text;
					setEntries((previous) => appendAssistantText(previous, text));
				} else if (event.type === "tool_call") {
					const tool = allTools.find((t) => t.name === event.name);
					if (!tool) continue;
					const id = event.id;
					const input = event.input;
					setEntries((previous) => [
						...previous,
						{ kind: "tool", id, tool, input },
					]);
				} else if (event.type === "tool_result") {
					const id = event.id;
					const result = event.result;
					setEntries((previous) =>
						previous.map((e) =>
							e.kind === "tool" && e.id === id ? { ...e, result } : e,
						),
					);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setEntries((previous) => [
				...previous,
				{ kind: "text", role: "assistant", text: message, isError: true },
			]);
		} finally {
			setIsStreaming(false);
		}
	};

	if (!providerState.ok) {
		return (
			<Box flexDirection="column" height={rows}>
				<Header title="kstack" subtitle="chat — failed to start" />
				<Box flexGrow={1} paddingX={1} flexDirection="column">
					<Text color="red">Could not initialize Anthropic provider:</Text>
					<Text>{providerState.error}</Text>
					<Box marginTop={1}>
						<Text dimColor>
							Set ANTHROPIC_API_KEY in your environment (or a .env file at the
							repo root) and restart. ctrl+c to quit.
						</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	const placeholder = isStreaming
		? "claude is replying — ctrl+c to quit"
		: "type a message and press enter — ctrl+c to quit";

	const inputBorderColor = isStreaming ? "yellow" : "green";

	return (
		<Box flexDirection="column" height={rows}>
			<Header title="kstack" subtitle={`chat — ${MODEL}`} />
			<HistoryView entries={entries} />
			{overlay ? (
				<OverlayPane>{overlay(() => setOverlay(null))}</OverlayPane>
			) : (
				<Box borderStyle="round" borderColor={inputBorderColor} paddingX={1}>
					<Text color={inputBorderColor}>{"> "}</Text>
					<TextInput
						placeholder={placeholder}
						disabled={isStreaming}
						onSubmit={handleSubmit}
					/>
				</Box>
			)}
		</Box>
	);
};

/**
 * Append streaming assistant text to the rolling assistant text entry, or
 * start a new one if the last entry isn't an open assistant text entry (e.g.
 * a tool entry just landed and the model is now back in text mode).
 */
function appendAssistantText(entries: Entry[], text: string): Entry[] {
	const last = entries[entries.length - 1];
	if (
		last &&
		last.kind === "text" &&
		last.role === "assistant" &&
		!last.isError
	) {
		return [
			...entries.slice(0, -1),
			{ ...last, text: last.text + text },
		];
	}
	return [...entries, { kind: "text", role: "assistant", text }];
}

render(<App />, { alternateScreen: true });
