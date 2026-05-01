import { useRef, useState } from "react";
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

const MODEL = "claude-haiku-4-5";

type Entry = {
	role: "user" | "assistant";
	text: string;
	isError?: boolean;
};

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

type VisualLine = {
	entry: Entry;
	text: string;
	isFirst: boolean;
};

function flattenEntries(entries: Entry[], width: number): VisualLine[] {
	const wrapWidth = Math.max(1, width - PREFIX_WIDTH);
	const lines: VisualLine[] = [];

	for (const entry of entries) {
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
				lines.push({ entry, text: "", isFirst });
				isFirst = false;
				continue;
			}
			for (let pos = 0; pos < paragraph.length; pos += wrapWidth) {
				lines.push({
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
			{visible.map((line, index) => (
				<VisualLineRow key={start + index} line={line} />
			))}
		</Box>
	);
};

const VisualLineRow = ({ line }: { line: VisualLine }) => {
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
	return (
		<Text>
			<Text color="cyan">‹ </Text>
			{text === "…" ? <Text dimColor>{text}</Text> : <Text>{text}</Text>}
		</Text>
	);
};

const App = () => {
	const { exit } = useApp();
	const { rows } = useWindowSize();
	const [entries, setEntries] = useState<Entry[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);

	useInput((input, key) => {
		if (key.ctrl && input === "c") exit();
	});

	const handleSubmit = async (input: string) => {
		if (input.length === 0 || isStreaming) return;
		if (!providerState.ok) return;

		const userEntry: Entry = { role: "user", text: input };
		const apiMessages: Message[] = [...entries, userEntry].map((entry) => ({
			role: entry.role,
			content: entry.text,
		}));

		setEntries((previous) => [
			...previous,
			userEntry,
			{ role: "assistant", text: "" },
		]);
		setIsStreaming(true);

		try {
			for await (const chunk of providerState.provider.stream({
				model: MODEL,
				messages: apiMessages,
			})) {
				if (chunk.type === "text_delta") {
					setEntries((previous) =>
						updateLastAssistant(previous, (last) => ({
							...last,
							text: last.text + chunk.text,
						})),
					);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setEntries((previous) =>
				updateLastAssistant(previous, () => ({
					role: "assistant",
					text: message,
					isError: true,
				})),
			);
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

	return (
		<Box flexDirection="column" height={rows}>
			<Header title="kstack" subtitle={`chat — ${MODEL}`} />
			<HistoryView entries={entries} />
			<Box
				borderStyle="round"
				borderColor={isStreaming ? "yellow" : "green"}
				paddingX={1}
			>
				<Text color={isStreaming ? "yellow" : "green"}>{"> "}</Text>
				<TextInput
					placeholder={placeholder}
					disabled={isStreaming}
					onSubmit={handleSubmit}
				/>
			</Box>
		</Box>
	);
};

function updateLastAssistant(
	entries: Entry[],
	transform: (last: Entry) => Entry,
): Entry[] {
	const last = entries[entries.length - 1];
	if (!last || last.role !== "assistant") return entries;
	return [...entries.slice(0, -1), transform(last)];
}

render(<App />, { alternateScreen: true });
