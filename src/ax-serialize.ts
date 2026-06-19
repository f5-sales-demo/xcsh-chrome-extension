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

function computeName(el: Element): string {
  return (
    el.getAttribute("aria-label") ??
    el.getAttribute("placeholder") ??
    (el.children.length === 0 ? el.textContent?.trim() : "") ??
    ""
  );
}

export function serializeAx(
  root: Element,
  refMap: Map<string, WeakRef<Element>>,
): AxRefNode {
  const ref = "ref_" + counter++;
  refMap.set(ref, new WeakRef(root));

  const children: AxRefNode[] = [];
  for (const child of Array.from(root.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    children.push(serializeAx(child, refMap));
  }

  return {
    role: computeRole(root),
    name: computeName(root),
    ref,
    children,
  };
}
