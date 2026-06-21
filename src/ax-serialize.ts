export interface AxRefNode {
  role: string;
  name: string;
  ref: string;
  children: AxRefNode[];
}

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "HEAD",
  "META",
  "LINK",
  "SVG",
]);

// Roles with no semantic value for matching — flattened away (children promoted)
// to keep the serialized tree small and fast on the heavy XC SPA.
const NOISE_ROLES = new Set(["generic", "presentation", "none", ""]);

// Roles whose accessible name comes from their text content.
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
      return el.hasAttribute("href") ? "link" : "generic";
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
      if (type === "text" || type === "search" || type === "email" || type === "url" || type === "tel" || type === "password")
        return "textbox";
      if (type === "number") return "spinbutton";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "button" || type === "submit") return "button";
      return "textbox";
    }
    default:
      return "generic";
  }
}

function computeName(el: Element, role: string, labelMap: Map<string, string>): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const doc = el.ownerDocument;
    const t = labelledby
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (t) return t;
  }

  if (role === "img") return el.getAttribute("alt")?.trim() ?? "";

  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const ph = el.getAttribute("placeholder");
    if (ph?.trim()) return ph.trim();
    const id = el.getAttribute("id");
    if (id && labelMap.has(id)) return labelMap.get(id) ?? "";
    const wrap = el.closest("label");
    const wt = wrap?.textContent?.replace(/\s+/g, " ").trim();
    if (wt) return wt;
    return el.getAttribute("name")?.trim() ?? "";
  }

  if (NAME_FROM_CONTENT.has(role)) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 200) return text;
  }

  if (el.children.length === 0) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 200) return text;
  }

  return el.getAttribute("title")?.trim() ?? "";
}

function buildLabelMap(doc: Document): Map<string, string> {
  const m = new Map<string, string>();
  for (const lbl of Array.from(doc.querySelectorAll("label[for]"))) {
    const f = lbl.getAttribute("for");
    if (f) m.set(f, (lbl.textContent ?? "").replace(/\s+/g, " ").trim());
  }
  return m;
}

// Walk an element, returning the pruned list of matchable nodes it contributes
// (itself if interesting, else its interesting descendants).
function walk(
  el: Element,
  refMap: Map<string, WeakRef<Element>>,
  labelMap: Map<string, string>,
  nameClaimed: boolean,
): AxRefNode[] {
  const role = computeRole(el);
  const name = nameClaimed ? "" : computeName(el, role, labelMap);
  const interesting = !NOISE_ROLES.has(role) || name.length > 0;
  const claimsContent = !nameClaimed && name.length > 0 && NAME_FROM_CONTENT.has(role);
  const childClaimed = nameClaimed || claimsContent;

  const childNodes: AxRefNode[] = [];
  for (const child of Array.from(el.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    childNodes.push(...walk(child, refMap, labelMap, childClaimed));
  }

  if (interesting) {
    const ref = "ref_" + counter++;
    refMap.set(ref, new WeakRef(el));
    return [{ role, name, ref, children: childNodes }];
  }
  return childNodes; // flatten away noise nodes
}

export function serializeAx(root: Element, refMap: Map<string, WeakRef<Element>>): AxRefNode {
  counter = 0;
  const doc = root.ownerDocument ?? document;
  const labelMap = buildLabelMap(doc);
  const children: AxRefNode[] = [];
  for (const child of Array.from(root.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    children.push(...walk(child, refMap, labelMap, false));
  }
  const ref = "ref_" + counter++;
  refMap.set(ref, new WeakRef(root));
  return { role: "RootWebArea", name: "", ref, children };
}
