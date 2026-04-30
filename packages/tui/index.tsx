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
	onSubmit: (value: string) => void;
};

const TextInput = ({ placeholder = "", onSubmit }: TextInputProps) => {
	const [value, setValue] = useState("");

	useInput((input, key) => {
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
	});

	usePaste((text) => {
		setValue((previous) => previous + text);
	});

	return (
		<Text>
			{value.length > 0 ? value : <Text dimColor>{placeholder}</Text>}
			<Text inverse> </Text>
		</Text>
	);
};

type HistoryViewProps = {
	entries: string[];
};

const HistoryView = ({ entries }: HistoryViewProps) => {
	const ref = useRef<DOMElement>(null);
	const { height, hasMeasured } = useBoxMetrics(
		ref as React.RefObject<DOMElement>,
	);
	const [offset, setOffset] = useState(0);

	const maxOffset = Math.max(0, entries.length - height);
	const clampedOffset = Math.min(offset, maxOffset);

	useInput((_input, key) => {
		if (key.upArrow) {
			setOffset((previous) => Math.min(previous + 1, maxOffset));
		} else if (key.downArrow) {
			setOffset((previous) => Math.max(0, previous - 1));
		}
	});

	const end = entries.length - clampedOffset;
	const start = Math.max(0, end - height);
	const visible = hasMeasured ? entries.slice(start, end) : [];

	return (
		<Box ref={ref} flexGrow={1} flexDirection="column" justifyContent="flex-end">
			{visible.map((entry, index) => (
				<Text key={start + index} dimColor>
					› {entry}
				</Text>
			))}
		</Box>
	);
};

const App = () => {
	const { exit } = useApp();
	const { rows } = useWindowSize();
	const [history, setHistory] = useState<string[]>([]);

	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			exit();
		}
	});

	return (
		<Box flexDirection="column" height={rows}>
			<Header
				title="kstack"
				subtitle="type something and press enter — ctrl+c to quit"
			/>
			<HistoryView entries={history} />
			<Box borderStyle="round" borderColor="green" paddingX={1}>
				<Text color="green">{"> "}</Text>
				<TextInput
					placeholder="type and press enter (ctrl+c to quit)"
					onSubmit={(value) => {
						if (value.length > 0) {
							setHistory((previous) => [...previous, value]);
						}
					}}
				/>
			</Box>
		</Box>
	);
};

render(<App />, { alternateScreen: true });
