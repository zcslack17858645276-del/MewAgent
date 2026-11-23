/**
 * IME spike: minimal Ink 8 + ink-text-input 6 program.
 *
 * Run:  npx tsx spikes/ime-spike.tsx
 *
 * Behaviour (as required by shared task task-1 / S0-1):
 *  - TextInput with React state; a second line prints `value=<...> len=<code points>`.
 *  - Every onChange is appended SYNCHRONOUSLY (fs.appendFileSync) as one JSON line to
 *    spikes/.out/ime-log.jsonl  =>  { ts, event:"change", value, len, ... }
 *  - On mount writes spikes/.out/ready.txt (pid + time) once the UI is rendered.
 *  - onSubmit appends { event:"submit", value } and exits the program.
 *
 * Extra fields (pid / codeUnits / counts) are intentionally added for evidence
 * correlation between several test rounds; the required fields are all present.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, render, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outDir = fileURLToPath(new URL('./.out/', import.meta.url));
const logPath = path.join(outDir, 'ime-log.jsonl');
const readyPath = path.join(outDir, 'ready.txt');

mkdirSync(outDir, { recursive: true });

/** Append one JSONL evidence line synchronously so no event can ever be lost. */
function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    pid: process.pid,
    event,
    ...fields,
  });
  appendFileSync(logPath, line + '\n', 'utf8');
}

function codePointLength(text: string): number {
  return [...text].length;
}

function App(): ReactElement {
  const { exit } = useApp();
  const [value, setValue] = useState('');
  const changeCountRef = useRef(0);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    logEvent('init', {
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      stdinIsTTY: Boolean(process.stdin.isTTY),
      stdoutIsTTY: Boolean(process.stdout.isTTY),
      argv: process.argv.slice(2),
    });
    writeFileSync(
      readyPath,
      [
        `pid=${process.pid}`,
        `time=${new Date().toISOString()}`,
        `ready_ms=${Date.now() - startedAtRef.current}`,
        `cwd=${process.cwd()}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }, []);

  const handleChange = (nextValue: string): void => {
    setValue(nextValue);
    changeCountRef.current += 1;
    logEvent('change', {
      value: nextValue,
      len: codePointLength(nextValue),
      codeUnits: nextValue.length,
      changeIndex: changeCountRef.current,
      elapsedMs: Date.now() - startedAtRef.current,
    });
  };

  const handleSubmit = (submitted: string): void => {
    logEvent('submit', {
      value: submitted,
      len: codePointLength(submitted),
      codeUnits: submitted.length,
      changes: changeCountRef.current,
      elapsedMs: Date.now() - startedAtRef.current,
    });
    exit();
    // Belt and braces: make sure the process really terminates so the
    // enclosing shell can move on even if stdin keeps the event loop alive.
    setTimeout(() => process.exit(0), 300);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        IME SPIKE — Ink 8 + ink-text-input 6
      </Text>
      <Text dimColor>中文/英文测试输入框（Enter 提交并退出）</Text>
      <Box>
        <Text color="green">{'> '}</Text>
        <TextInput value={value} onChange={handleChange} onSubmit={handleSubmit} />
      </Box>
      <Text>
        value=<Text color="yellow">{value}</Text> len=
        <Text color="yellow">{String(codePointLength(value))}</Text>
        {'  '}
        codeUnits=<Text color="yellow">{String(value.length)}</Text>
      </Text>
      <Text dimColor>
        pid={process.pid} · changes={changeCountRef.current} · log=spikes/.out/ime-log.jsonl
      </Text>
    </Box>
  );
}

render(<App />);
