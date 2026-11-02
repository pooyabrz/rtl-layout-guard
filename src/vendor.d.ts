declare module 'postcss-safe-parser' {
  import type { Root, ProcessOptions } from 'postcss';
  export default function parse(css: string, options?: ProcessOptions): Root;
}
