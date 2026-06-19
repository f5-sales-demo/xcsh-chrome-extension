import { serializeAx, type AxRefNode } from "./ax-serialize";

const REFMAP = new Map<string, WeakRef<Element>>();

(globalThis as any).__xcshReadAx = (): AxRefNode => {
  REFMAP.clear(); // rebuild each call
  return serializeAx(document.documentElement, REFMAP);
};

(globalThis as any).__xcshResolveRef = (
  ref: string,
): { x: number; y: number } | null => {
  const el = REFMAP.get(ref)?.deref();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
