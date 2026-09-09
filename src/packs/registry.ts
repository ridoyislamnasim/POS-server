import { FashionPackV1 } from "./fashion.js";

const packs = {
  [FashionPackV1.key]: FashionPackV1,
} as const;

export type IndustryPack = typeof FashionPackV1;

export const IndustryPackRegistry = {
  get(key: string): IndustryPack | undefined {
    return packs[key as keyof typeof packs];
  },
  matrixAxes(key: string) {
    return this.get(key)?.matrix ?? { row: "colour", col: "size", widget: "matrix" };
  },
};
