// types/assets.d.ts
// Type declarations for asset imports

declare module '*.mp3' {
  const content: number;
  export default content;
}

declare module '*.wav' {
  const content: number;
  export default content;
}
