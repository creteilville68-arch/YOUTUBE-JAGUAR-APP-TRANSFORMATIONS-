declare module "@diffusionstudio/piper-wasm/build/piper_phonemize.js" {
  type PiperPhonemizeModule = {
    ready: Promise<unknown>;
    callMain: (args: string[]) => void;
    print?: (s: string) => void;
    printErr?: (s: string) => void;
  };
  function createPiperPhonemize(
    moduleArg?: Partial<PiperPhonemizeModule> & {
      noInitialRun?: boolean;
      locateFile?: (url: string) => string;
    },
  ): Promise<PiperPhonemizeModule>;
  export default createPiperPhonemize;
}
