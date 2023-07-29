import {
  BaseSource,
  Context,
  Item,
} from "https://deno.land/x/ddc_vim@v3.9.1/types.ts";
import { assertEquals } from "https://deno.land/std@0.196.0/assert/mod.ts";
import { TextLineStream } from "https://deno.land/std@0.196.0/streams/mod.ts";

type Params = Record<never, never>;

export class Source extends BaseSource<Params> {
  private _proc: Deno.ChildProcess | undefined = undefined;

  constructor() {
    super();

    try {
      this._proc = new Deno.Command(
        "mocword",
        {
          args: ["--limit", "100"],
          stdout: "piped",
          stderr: "piped",
          stdin: "piped",
        },
      ).spawn();
    } catch (_e) {
      console.error('[ddc-mocword] Run "mocword" is failed.');
      console.error('[ddc-mocword] "mocword" binary seems not installed.');
      console.error("[ddc-mocword] Or env MOCWORD_DATA is not set.");
    }
  }

  override async gather(args: {
    context: Context;
    completeStr: string;
  }): Promise<Item[]> {
    if (!this._proc || !this._proc.stdin || !this._proc.stdout) {
      return [];
    }

    const [sentence, offset] = extractWords(args.completeStr);
    const query = offset > 0 ? sentence : args.context.input;
    const precedingLetters = args.completeStr.slice(0, offset);

    try {
      const writer = this._proc.stdin.getWriter();
      await writer.ready;
      await writer.write(new TextEncoder().encode(query + "\n"));
      writer.releaseLock();

      for await (const line of iterLine(this._proc.stdout)) {
        return line.split(/\s/).map((word: string) => ({
          word: precedingLetters.concat(word),
        }));
      }
    } catch (_e) {
      // NOTE: ReadableStream may be locked
    }

    return [];
  }

  override params(): Params {
    return {};
  }
}

async function* iterLine(r: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const lines = r
    .pipeThrough(new TextDecoderStream(), {
      preventAbort: true,
      preventCancel: true,
      preventClose: true,
    })
    .pipeThrough(new TextLineStream());

  for await (const line of lines) {
    if ((line as string).length) {
      yield line as string;
    }
  }
}

function extractWords(
  completeStr: string,
): [string, number] {
  const upperCaseRegexp = /[A-Z][A-Z]+/g;

  // Also matched to PascalCase
  const camelCaseRegexp = /([A-Z]?[a-z]+|[A-Z][a-z]*)/g;

  // Also matched to kebab-case, etc.
  const snakeCaseRegexp = /[a-z][a-z]*/g;

  let matches: string[] | null = completeStr.match(upperCaseRegexp);
  if (matches === null) matches = completeStr.match(camelCaseRegexp);
  if (matches === null) matches = completeStr.match(snakeCaseRegexp);
  if (matches === null) return [completeStr, 0];

  const sentence = matches.join(" ");
  if (completeStr.match(/[^a-zA-Z]+$/)) {
    return [sentence.concat(" "), completeStr.length];
  }

  const lastWord = matches.at(-1) || completeStr;
  const offset = completeStr.lastIndexOf(lastWord);
  return [sentence, offset];
}

Deno.test("extractWords", () => {
  assertEquals(
    extractWords("input"),
    ["input", 0],
  );
  assertEquals(
    extractWords("UPPER_CASE_INPUT"),
    ["UPPER CASE INPUT", 11],
  );
  assertEquals(
    extractWords("camelCaseInput"),
    ["camel Case Input", 9],
  );
  assertEquals(
    extractWords("_snake_case_input"),
    ["snake case input", 12],
  );
  assertEquals(
    extractWords("_unfinished_input_"),
    ["unfinished input ", 18],
  );
  assertEquals(
    extractWords("unfinishedI"),
    ["unfinished I", 10],
  );
  assertEquals(
    extractWords("_i"),
    ["i", 1],
  );
});
