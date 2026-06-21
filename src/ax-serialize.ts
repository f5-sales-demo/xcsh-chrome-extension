export interface AxRefNode {
  role: string;
  name: string;
  ref: string;
  children: AxRefNode[];
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

let counter = 0;

function computeRole(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
      return "button";
    case "textarea":
      return "textbox";
    case "select":
      return "combobox";
    case "a":
      return "link";
    case "img":
      return "img";
    case "nav":
      return "navigation";
    case "table":
      return "table";
    case "ul":
    case "ol":
      return "list";
    case "li":
      return "listitem";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (type === "text" || type === "search") return "textbox";
      if (type === "checkbox") return "checkbox";
      return "generic";
    }
    default:
      return "generic";
  }
}

// Roles whose accessible name is computed from their text content (concatenated
// descendant text), per the ARIA accessible-name algorithm.
const NAME_FROM_CONTENT = new Set([
  "heading",
  "button",
  "link",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "checkbox",
  "radio",
  "switch",
  "listitem",
  "tooltip",
]);

function labelledByText(el: Element): string {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function computeName(el: Element, role: string): string {
  // 1. Explicit ARIA label.
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();
  const labelled = labelledByText(el);
  if (labelled) return labelled;

  if (role === "img") return el.getAttribute("alt")?.trim() ?? "";

  // 2. Form controls: placeholder, associated <label>, or name attribute.
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const ph = el.getAttribute("placeholder");
    if (ph?.trim()) return ph.trim();
    const id = el.getAttribute("id");
    if (id) {
      const lbl = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
      const t = lbl?.textContent?.trim();
      if (t) return t;
    }
    const wrap = el.closest("label");
    const wt = wrap?.textContent?.trim();
    if (wt) return wt;
    return el.getAttribute("name")?.trim() ?? "";
  }

  // 3. Name-from-content roles: the concatenated descendant text.
  if (NAME_FROM_CONTENT.has(role)) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 200) return text;
  }

  // 4. Leaf elements: their direct text.
  if (el.children.length === 0) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 200) return text;
  }

  // 5. title attribute fallback.
  return el.getAttribute("title")?.trim() ?? "";
}

export function serializeAx(
  root: Element,
  refMap: Map<string, WeakRef<Element>>,
  nameClaimed = false,
): AxRefNode {
  const ref = "ref_" + counter++;
  refMap.set(ref, new WeakRef(root));

  const role = computeRole(root);
  // If an ancestor already claimed this subtree's text as its name, this node
  // (and its descendants) are presentational — don't duplicate the name.
  const name = nameClaimed ? "" : computeName(root, role);
  const claimsContent = !nameClaimed && name.length > 0 && NAME_FROM_CONTENT.has(role);
  const childClaimed = nameClaimed || claimsContent;

  const children: AxRefNode[] = [];
  for (const child of Array.from(root.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    children.push(serializeAx(child, refMap, childClaimed));
  }

  return { role, name, ref, children };
}
