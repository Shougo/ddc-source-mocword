import { BaseSource, Item } from "https://deno.land/x/ddc_vim@v5.0.0/types.ts";
import {
  GatherArguments,
  OnInitArguments,
} from "https://deno.land/x/ddc_vim@v5.0.0/base/source.ts";
import { printError } from "https://deno.land/x/ddc_vim@v5.0.0/utils.ts";
import { assertEquals } from "jsr:@std/assert@0.225.1";
import { TextLineStream } from "jsr:@std/streams@0.224.0/text-line-stream";

type Params = Record<string, never>;

const encoder = new TextEncoder();

export class Source extends BaseSource<Params> {
  #proc: Deno.ChildProcess | undefined;
  #readCallback: (result: string) => void = () => {};
  #writer: WritableStreamDefaultWriter<Uint8Array> | undefined;

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    try {
      this.#proc = new Deno.Command(
        "mocword",
        {
          args: ["--limit", "100"],
          stdout: "piped",
          stderr: "piped",
          stdin: "piped",
        },
      ).spawn();
    } catch (error: unknown) {
      if (error instanceof Deno.errors.NotFound) {
        await printError(
          args.denops,
          'Failed to spawn "mocword". "mocword" binary seems not installed or not in $PATH.',
        );
        return;
      }
      throw error;
    }
    this.#proc.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .pipeTo(
        new WritableStream({
          write: (chunk: string) => this.#readCallback(chunk),
        }),
      ).finally(() => {
        this.#proc = undefined;
        this.#readCallback = () => {};
        this.#writer = undefined;
      });
    this.#proc.status.then(async (status) => {
      if (!status.success) {
        await printError(
          args.denops,
          '"mocword" exited with non-zero status code. $MOCWORD_DATA seems not set correctly.',
        );
      }
    });
    this.#writer = this.#proc.stdin.getWriter();
  }

  override async gather(args: GatherArguments<Params>): Promise<Item[]> {
    if (!this.#proc || !this.#writer) {
      return [];
    }

    const [sentence, offset] = extractWords(args.completeStr);
    const query = offset > 0 ? sentence : args.context.input;
    const precedingLetters = args.completeStr.slice(0, offset);

    const { promise, resolve } = Promise.withResolvers<string>();
    this.#readCallback = resolve;

    await this.#writer.write(encoder.encode(query + "\n"));
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
