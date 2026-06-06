type YamlRecord = Record<string, unknown>;

function stripComment(value: string): string {
  let quote = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
    } else if (character === "'" || character === "\"") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(value[index - 1]!))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function splitMapping(line: string): [string, string] | undefined {
  let quote = "";
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (quote) {
      if (character === quote && line[index - 1] !== "\\") quote = "";
    } else if (character === "'" || character === "\"") {
      quote = character;
    } else if (character === ":" && (index === line.length - 1 || /\s/.test(line[index + 1]!))) {
      return [line.slice(0, index), line.slice(index + 1)];
    }
  }
  return undefined;
}

function scalar(raw: string): unknown {
  const value = stripComment(raw).trim();
  if (!value) return {};
  if (value === "{}") return {};
  if (value === "[]") return [];
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith("\"") && value.endsWith("\""))) {
    const body = value.slice(1, -1);
    return value.startsWith("'") ? body.replaceAll("''", "'") : JSON.parse(value);
  }
  return value;
}

function key(raw: string): string {
  return String(scalar(raw.trim()));
}

/**
 * Parses the mapping subset used by pnpm lockfiles and workspace settings.
 * Sequences and block scalars are intentionally ignored because dependency
 * detection reads mapping-based sections only.
 */
export function parseYamlMappings(content: string): YamlRecord {
  const root: YamlRecord = {};
  const stack: Array<{ indent: number; value: YamlRecord }> = [{ indent: -1, value: root }];

  for (const [lineNumber, original] of content.replaceAll("\t", "  ").split(/\r?\n/).entries()) {
    if (!original.trim() || original.trimStart().startsWith("#") || original.trimStart().startsWith("---")) continue;
    const indent = original.length - original.trimStart().length;
    const line = stripComment(original.trim());
    if (!line || line.startsWith("- ")) continue;
    const mapping = splitMapping(line);
    if (!mapping) throw new Error(`Unsupported YAML at line ${lineNumber + 1}`);
    while (stack.length > 1 && indent <= stack.at(-1)!.indent) stack.pop();
    const parent = stack.at(-1)!.value;
    const mappingKey = key(mapping[0]);
    const value = scalar(mapping[1]);
    parent[mappingKey] = value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      stack.push({ indent, value: value as YamlRecord });
    }
  }
  return root;
}
