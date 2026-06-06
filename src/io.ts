import { appendFileSync } from "node:fs";

export function input(name: string, required = false): string {
  const key = `INPUT_${name.replaceAll("-", "_").toUpperCase()}`;
  const value = process.env[key]?.trim() ?? "";
  if (required && !value) throw new Error(`Missing required input: ${name}`);
  return value;
}

export function booleanInput(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(input(name));
}

export function setOutput(name: string, value: string | number | boolean): void {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  appendFileSync(output, `${name}=${String(value).replaceAll("\n", "%0A")}\n`);
}

export function info(message: string): void {
  console.log(message);
}

export function warning(message: string): void {
  console.log(`::warning::${message}`);
}

export function fail(message: string): never {
  console.log(`::error::${message}`);
  process.exitCode = 1;
  throw new Error(message);
}
