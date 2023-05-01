import {
  BaseSource,
  Context,
  Item,
} from "https://deno.land/x/ddc_vim@v3.4.0/types.ts";
import { assertEquals } from "https://deno.land/std@0.185.0/testing/asserts.ts";
import { TextLineStream } from "https://deno.land/std@0.185.0/streams/mod.ts";

type Params = Record<never, never>;

export class Source extends BaseSource<Params> {
  _proc: Deno.ChildProcess | undefined = undefined;

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

    const completeStr = args.completeStr;
    const [sentence, offset] = extractWords(completeStr);
    const query = offset > 0 ? sentence : args.context.input;
    const precedingLetters = completeStr.slice(0, offset);

    const writer = this._proc.stdin.getWriter();
    await writer.ready;
    await writer.write(new TextEncoder().encode(query + "\n"));
    writer.releaseLock();

    for await (const line of iterLine(this._proc.stdout)) {
      return line.split(/\s/).map((word: string) => ({
        word: precedingLetters.concat(word),
      }));
    }

    return [];
  }

  override params(): Params {
    return {};
  }
}

async function* iterLine(r: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const lines = r
    .pipeThrough(new TextDecoderStream(), { preventCancel: true })
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
  const camelCaseRegexp = /([A-Z]?[a-z]+|[A-Z][a-z]*)/g; // Also matched to PascalCase
  const snakeCaseRegexp = /[a-z][a-z]*/g; // Also matched to kebab-case, etc.
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

Deno.test("gather", async (t: Deno.TestContext) => {
  const s = new Source();
  await t.step("camelCaseInput", async () => {
    assertEquals(
      await s.gather({
        completeStr: "camelCaseInput",
        context: {
          changedTick: 42,
          event: "TextChangedI",
          filetype: "foo",
          input: "This is a camelCaseInput",
          lineNr: 1,
          nextInput: "",
        },
      }),
      [
        { word: "camelCaseInput" },
        { word: "camelCaseInputs" },
        { word: "camelCaseInputStream" },
        { word: "camelCaseInputBox" },
        { word: "camelCaseInputting" },
        { word: "camelCaseInputOutput" },
        { word: "camelCaseInputStreamReader" },
      ],
    );
  });
  await t.step("_input", async () => {
    assertEquals(
      await s.gather({
        completeStr: "_snake_case_input",
        context: {
          changedTick: 42,
          event: "TextChangedI",
          filetype: "foo",
          input: "This is a _snake_case_input",
          lineNr: 1,
          nextInput: "",
        },
      }),
      [
        { word: "_snake_case_input" },
        { word: "_snake_case_inputs" },
        { word: "_snake_case_inputting" },
        { word: "_snake_case_inputted" },
        { word: "_snake_case_inputoutput" },
        { word: "_snake_case_inputed" },
        { word: "_snake_case_inputing" },
      ],
    );
  });
  s?._proc?.stdout?.close();
  s?._proc?.stderr?.close();
  s?._proc?.stdin?.close();
  s?._proc?.close();
});
