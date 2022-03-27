import {
  BaseSource,
  Context,
  Item,
} from "https://deno.land/x/ddc_vim@v2.2.0/types.ts";
import { readLines } from "https://deno.land/std@0.132.0/io/mod.ts";
import { writeAll } from "https://deno.land/std@0.132.0/streams/mod.ts";

type Params = Record<never, never>;

export class Source extends BaseSource<Params> {
  _proc: Deno.Process | undefined = undefined;

  constructor() {
    super();

    try {
      this._proc = Deno.run({
        cmd: ["mocword", "--limit", "100"],
        stdout: "piped",
        stderr: "piped",
        stdin: "piped",
      });
    } catch (e) {
      console.error("[ddc-mocword] Run \"mocword\" is failed.");
      console.error("[ddc-mocword] \"mocword\" binary seems not installed.");
      console.error("[ddc-mocword] Or env MOCWORD_DATA is not set.");
    }
  }

  async gather(args: {
    context: Context,
  }): Promise<Item[]> {
    if (!this._proc || !this._proc.stdin || !this._proc.stdout) {
      return [];
    }

    await writeAll(this._proc.stdin,
                   new TextEncoder().encode(args.context.input + "\n"));

    // Todo: Better implementation
    for await (const line of readLines(this._proc.stdout)) {
      return line.split(/\s/).map((word: string) => ({ word }));
    }

    return [];
  }

  params(): Params { return {}; }
}
