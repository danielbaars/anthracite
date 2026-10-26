import path from 'path';

// Shared by the test harnesses and GitRepo, which also powers `an demo`.
export function getTestCliCommand(
  args: readonly string[]
): [string, ...string[]] {
  const binary = process.env.CHARCOAL_TEST_BINARY;
  if (binary && !path.isAbsolute(binary)) {
    throw new Error('CHARCOAL_TEST_BINARY must be an absolute path');
  }
  return binary
    ? [binary, ...args]
    : [process.execPath, path.resolve(__dirname, '../../index.js'), ...args];
}
