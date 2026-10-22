// Walkthrough-mode replacement for @tidecloak/js (only IAMService.doEncrypt/doDecrypt are used directly).
import { parsePolicy, check, sealData, openData, pause } from "./sim";

type Item = { data?: string; encrypted?: string; tags: string[] };
export const IAMService = {
  async doEncrypt(items: Item[], policy: Uint8Array) {
    await pause(500);
    const p = parsePolicy(policy);
    return Promise.all(items.map((i) => { check(p, i.tags, "encrypt"); return sealData(i.data!, i.tags[0]); }));
  },
  async doDecrypt(items: Item[], policy: Uint8Array) {
    await pause(600);
    const p = parsePolicy(policy);
    items.forEach((i) => check(p, i.tags, "decrypt"));
    return Promise.all(items.map((i) => openData(i.encrypted!, i.tags[0])));
  },
};
