import { BaseSource, Item } from "https://deno.land/x/ddc_vim@v4.3.1/types.ts";
import {
  GatherArguments,
  OnInitArguments,
} from "https://deno.land/x/ddc_vim@v4.3.1/base/source.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/mod.ts";
import { TextLineStream } from "https://deno.land/std@0.210.0/streams/text_line_stream.ts";

type Params = Record<string, never>;

const encoder = new TextEncoder();

export class Source extends BaseSource<Params> {
  private proc: Deno.ChildProcess | undefined;
  private readCallback: (result: string) => void = () => {};
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    try {
      this.proc = new Deno.Command(
        "mocword",
        {
          args: ["--limit", "100"],
          stdout: "piped",
          stderr: "piped",
          stdin: "piped",
        },
      ).spawn();
    } catch {
      await args.denops.call(
        "ddc#util#print_error",
        'Spawning "mocword" is failed. "mocword" binary seems not installed',
        "ddc-source-mocword",
      );
      return;
    }
    this.proc.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .pipeTo(
        new WritableStream({
          write: (chunk: string) => this.readCallback(chunk),
        }),
      ).finally(() => {
        this.proc = undefined;
        this.readCallback = () => {};
        this.writer = undefined;
      });
    this.writer = this.proc.stdin.getWriter();
  }

  override async gather(args: GatherArguments<Params>): Promise<Item[]> {
    if (!this.proc || !this.writer) {
      return [];
    }

    const [sentence, offset] = extractWords(args.completeStr);
    const query = offset > 0 ? sentence : args.context.input;
    const precedingLetters = args.completeStr.slice(0, offset);

    const { promise, resolve } = Promise.withResolvers<string>();
    this.readCallback = resolve;

    await this.writer.write(encoder.encode(query + "\n"));
    return (await promise).split(/\s/)
      .map((word: string) => ({ word: precedingLetters.concat(word) }));
  }

  override params(): Params {
    return {};
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
