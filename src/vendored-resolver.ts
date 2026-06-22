/**
 * Vendored AX resolver — a pure-TypeScript copy of xcsh's selector + AX matching
 * logic so the service worker can resolve the catalogue's selector dialect
 * (role / name / text) against an accessibility tree without Puppeteer/CDP.
 *
 * SOURCE OF TRUTH: this is a manual copy of
 *   xcsh/packages/coding-agent/src/browser/selector.ts  (Locator, KNOWN_ROLES, parseLocator)
 *   xcsh/packages/coding-agent/src/browser/ax.ts         (AxNode, NotFoundError, matchNode, matchNodes)
 * Keep in sync by hand. Documented follow-up: publish a shared package.
 */

// --- selector.ts -----------------------------------------------------------

export type Locator =
  | { kind: 'roleName'; role: string; name: string }
  | { kind: 'role'; role: string }
  | { kind: 'text'; text: string }
  | { kind: 'css'; css: string };

/** ARIA roles the catalogue addresses by bare role or role+name. */
export const KNOWN_ROLES: ReadonlySet<string> = new Set([
  'button',
  'tab',
  'option',
  'textbox',
  'spinbutton',
  'listbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'link',
  'menuitem',
  'searchbox',
  'slider',
  'treeitem',
]);

const TEXT_RE = /^text\('([^']*)'\)$/;
const ROLE_TEXT_RE = /^([a-z]+):text\('([^']*)'\)$/;
const ROLE_NAME_RE = /^([a-z]+)\[name='([^']*)'\]$/;
const BARE_ROLE_RE = /^[a-z]+$/;

export function parseLocator(selector: string): Locator {
  const text = selector.match(TEXT_RE);
  // biome-ignore lint/style/noNonNullAssertion: resolver match
  if (text) return { kind: 'text', text: text[1]! };
  const roleText = selector.match(ROLE_TEXT_RE);
  // biome-ignore lint/style/noNonNullAssertion: resolver match
  if (roleText) return { kind: 'roleName', role: roleText[1]!, name: roleText[2]! };
  const roleName = selector.match(ROLE_NAME_RE);
  // biome-ignore lint/style/noNonNullAssertion: resolver match
  if (roleName) return { kind: 'roleName', role: roleName[1]!, name: roleName[2]! };
  if (BARE_ROLE_RE.test(selector) && KNOWN_ROLES.has(selector)) return { kind: 'role', role: selector };
  return { kind: 'css', css: selector };
}

// --- ax.ts -----------------------------------------------------------------

export interface AxNode {
  role: string;
  name?: string;
  children?: AxNode[];
  [k: string]: unknown;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class AmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguousError';
  }
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function collect(node: AxNode, results: AxNode[]): void {
  results.push(node);
  for (const child of node.children ?? []) {
    collect(child, results);
  }
}

export function matchNode(tree: AxNode, loc: Locator): AxNode {
  if (loc.kind === 'css') {
    throw new Error('css locators cannot be resolved against an AX tree — resolve live via CDP');
  }

  const all: AxNode[] = [];
  collect(tree, all);

  let matches: AxNode[];

  if (loc.kind === 'roleName') {
    const wantRole = loc.role;
    const wantName = norm(loc.name);
    matches = all.filter((n) => {
      if (n.role !== wantRole) return false;
      const nodeName = norm(n.name ?? '');
      // roleName from role:text('X') pattern — text match (includes)
      // roleName from role[name='X'] pattern — exact match
      // We always use exact match for roleName kind (the parser normalises both patterns to roleName)
      return nodeName === wantName;
    });
  } else if (loc.kind === 'role') {
    matches = all.filter((n) => n.role === loc.role);
  } else {
    // kind === "text"
    const want = norm(loc.text);
    matches = all.filter((n) => {
      const nodeName = norm(n.name ?? '');
      return nodeName === want || nodeName.includes(want);
    });
  }

  if (matches.length === 0) {
    // Collect candidates for helpful error message
    let hint = '';
    if (loc.kind === 'roleName' || loc.kind === 'role') {
      const sameRole = all.filter((n) => n.role === loc.role && n.name).map((n) => JSON.stringify(n.name));
      if (sameRole.length > 0) {
        hint = ` (same-role candidates: ${sameRole.slice(0, 5).join(', ')})`;
      }
    } else if (loc.kind === 'text') {
      // For text kind, list nearby text candidates (non-empty normalized names)
      const textCandidates: string[] = [];
      const seen = new Set<string>();
      for (const node of all) {
        if (node.name) {
          const normalized = norm(node.name);
          if (normalized.length > 0 && !seen.has(normalized)) {
            seen.add(normalized);
            textCandidates.push(JSON.stringify(normalized));
            if (textCandidates.length >= 5) break;
          }
        }
      }
      if (textCandidates.length > 0) {
        hint = ` (nearby text candidates: ${textCandidates.join(', ')})`;
      }
    }
    throw new NotFoundError(`No AX node found for ${JSON.stringify(loc)}${hint}`);
  }

  // For text locators, return the first match (presence semantics).
  // For roleName and role, enforce strict 1:1 matching.
  if (loc.kind === 'text') {
    // biome-ignore lint/style/noNonNullAssertion: resolver match
    return matches[0]!;
  }

  if (matches.length > 1) {
    const names = matches.map((n) => JSON.stringify(n.name ?? n.role));
    throw new AmbiguousError(
      `${matches.length} AX nodes match ${JSON.stringify(loc)}: ${names.slice(0, 5).join(', ')}`,
    );
  }

  // biome-ignore lint/style/noNonNullAssertion: resolver match
  return matches[0]!;
}

export function matchNodes(tree: AxNode, loc: Locator): AxNode[] {
  if (loc.kind === 'css') {
    throw new Error('css locators cannot be resolved against an AX tree — resolve live via CDP');
  }

  const all: AxNode[] = [];
  collect(tree, all);

  if (loc.kind === 'roleName') {
    const wantRole = loc.role;
    const wantName = norm(loc.name);
    return all.filter((n) => n.role === wantRole && norm(n.name ?? '') === wantName);
  } else if (loc.kind === 'role') {
    return all.filter((n) => n.role === loc.role);
  } else {
    // kind === "text"
    const want = norm(loc.text);
    return all.filter((n) => {
      const nodeName = norm(n.name ?? '');
      return nodeName === want || nodeName.includes(want);
    });
  }
}
