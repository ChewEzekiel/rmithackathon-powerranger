import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// One JSON file is the whole database. It is deliberately the thing a curious (or breached)
// platform operator would open: it holds ciphertext, signed policies and metadata, never plaintext.
// ponytail: single JSON file with read-modify-write, swap for SQLite/Postgres beyond a demo.
const FILE = join(process.cwd(), "data", "store.json");

export interface Profile { sub: string; name: string; institution: string }
export interface Post {
  id: string;
  roomId: string;
  authorSub: string;
  authorName: string;
  institution: string;
  kind: "finding" | "dataset" | "question";
  ciphertext: string; // Tide-encrypted JSON {title, body}; only room members can open it
  createdAt: string;
}
export interface AuditEvent { at: string; who: string; what: string }
export interface JoinRequest { sub: string; name: string; institution: string; roomId: string; at: string }
export interface Store {
  profiles: Record<string, Profile>;
  policies: Record<string, { policy: string; sealedBy: string; sealedAt: string }>;
  posts: Post[];
  joinRequests: JoinRequest[];
  audit: AuditEvent[];
}

export function readStore(): Store {
  const empty: Store = { profiles: {}, policies: {}, posts: [], joinRequests: [], audit: [] };
  try {
    return { ...empty, ...JSON.parse(readFileSync(FILE, "utf-8")) };
  } catch {
    return empty;
  }
}

export function updateStore(fn: (s: Store) => void): Store {
  const s = readStore();
  fn(s);
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
  return s;
}

export function audit(who: string, what: string) {
  updateStore((s) => {
    s.audit.unshift({ at: new Date().toISOString(), who, what });
    s.audit = s.audit.slice(0, 200);
  });
}
