import { randomInt } from "node:crypto";

export interface DiceSpec {
  count: number;
  sides: number;
  modifier: number;
  mode: "normal" | "adv" | "dis";
  secret: boolean;
}

export interface DiceResult {
  spec: DiceSpec;
  /** adv/dis면 두 번 굴린 결과가 각각 들어간다(첫 번째가 채택된 쪽). normal이면 항목 1개. */
  rolls: number[][];
  total: number;
}

const EXPR_RE = /^(\d+)d(\d+)([+-]\d+)?$/i;

/** "1d20+5 adv gm" 같은 문자열을 파싱한다. 순수 함수 — 랜덤을 쓰지 않는다. */
export function parseDiceExpression(input: string): DiceSpec {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new Error("빈 주사위 표현식이다.");

  const [exprToken, ...flagTokens] = tokens;
  const match = EXPR_RE.exec(exprToken!);
  if (!match) {
    throw new Error(`"${exprToken}"은(는) 올바른 주사위 표현식이 아니다 (예: 1d20+5).`);
  }
  const count = Number.parseInt(match[1]!, 10);
  const sides = Number.parseInt(match[2]!, 10);
  const modifier = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (count < 1 || count > 100) throw new Error(`주사위 개수는 1~100이어야 한다 (받은 값: ${count}).`);
  if (sides < 1 || sides > 1000) throw new Error(`면 수는 1~1000이어야 한다 (받은 값: ${sides}).`);
  if (modifier < -999 || modifier > 999) throw new Error(`수정치는 -999~999여야 한다 (받은 값: ${modifier}).`);

  let mode: DiceSpec["mode"] = "normal";
  let secret = false;
  for (const raw of flagTokens) {
    const flag = raw.toLowerCase();
    if (flag === "adv") {
      if (mode === "dis") throw new Error("adv와 dis를 동시에 지정할 수 없다.");
      mode = "adv";
    } else if (flag === "dis") {
      if (mode === "adv") throw new Error("adv와 dis를 동시에 지정할 수 없다.");
      mode = "dis";
    } else if (flag === "gm") {
      secret = true;
    } else {
      throw new Error(`알 수 없는 옵션 "${raw}" — adv/dis/gm만 허용된다.`);
    }
  }

  return { count, sides, modifier, mode, secret };
}

function rollOnce(spec: DiceSpec): number[] {
  const dice: number[] = [];
  for (let i = 0; i < spec.count; i++) dice.push(randomInt(1, spec.sides + 1));
  return dice;
}

function sumWithModifier(dice: number[], modifier: number): number {
  return dice.reduce((a, b) => a + b, 0) + modifier;
}

/** 서버 crypto RNG로 실제 굴림을 수행한다. */
export function rollDice(spec: DiceSpec): DiceResult {
  if (spec.mode === "normal") {
    const dice = rollOnce(spec);
    return { spec, rolls: [dice], total: sumWithModifier(dice, spec.modifier) };
  }

  const a = rollOnce(spec);
  const b = rollOnce(spec);
  const totalA = sumWithModifier(a, spec.modifier);
  const totalB = sumWithModifier(b, spec.modifier);
  const pickA = spec.mode === "adv" ? totalA >= totalB : totalA <= totalB;
  const [chosen, other] = pickA ? [a, b] : [b, a];
  const total = pickA ? totalA : totalB;
  return { spec, rolls: [chosen, other], total };
}
