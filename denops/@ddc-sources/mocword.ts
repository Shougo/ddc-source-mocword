import { type Item } from "jsr:@shougo/ddc-vim@~9.1.0/types";
import {
  BaseSource,
  type GatherArguments,
  type OnInitArguments,
} from "jsr:@shougo/ddc-vim@~9.1.0/source";
import { printError } from "jsr:@shougo/ddc-vim@~9.1.0/utils";

import { assertEquals } from "jsr:@std/assert@~1.0.3/equals";
import { TextLineStream } from "jsr:@std/streams@~1.0.3/text-line-stream";

type Params = {
  commandPath: string;
};

const encoder = new TextEncoder();

export class Source extends BaseSource<Params> {
  #proc: Deno.ChildProcess | undefined;
  #readCallback: (result: string) => void = () => {};
  #writer: WritableStreamDefaultWriter<Uint8Array> | undefined;

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    const commandPath = args.sourceParams.commandPath;
    try {
      this.#proc = new Deno.Command(
        commandPath,
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
          `Failed to spawn ${commandPath}. It seems not installed or not in $PATH.`,
        );
        await printError(
          args.denops,
          `$PATH=${Deno.env.get("PATH")}`,
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
          `${commandPath} exited with non-zero status code. $MOCWORD_DATA seems not set correctly.`,
        );
        await printError(
          args.denops,
          `$MOCWORD_DATA=${Deno.env.get("MOCWORD_DATA")}`,
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
    return {
      commandPath: "mocword",
    };
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
