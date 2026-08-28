// A small recursive-descent arithmetic evaluator. Deliberately not eval()/Function() —
// the input string originates from model output, so parsing it as arithmetic grammar
// rather than executing it as code closes off any code-injection surface by construction.

class ParseError extends Error {}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let n = c;
      i++;
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        n += expr[i];
        i++;
      }
      tokens.push(n);
    } else if ("+-*/^(),".includes(c)) {
      tokens.push(c);
      i++;
    } else if (/[a-zA-Z]/.test(c)) {
      let n = c;
      i++;
      while (i < expr.length && /[a-zA-Z]/.test(expr[i])) {
        n += expr[i];
        i++;
      }
      tokens.push(n);
    } else {
      throw new ParseError(`Unexpected character '${c}'`);
    }
  }
  return tokens;
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
};

class Parser {
  tokens: string[];
  pos = 0;
  constructor(tokens: string[]) {
    this.tokens = tokens;
  }
  peek() {
    return this.tokens[this.pos];
  }
  next() {
    return this.tokens[this.pos++];
  }
  parseExpression(): number {
    let left = this.parseTerm();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.next();
      const right = this.parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  parseTerm(): number {
    let left = this.parseUnary();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.next();
      const right = this.parseUnary();
      if (op === "/" && right === 0) throw new ParseError("Division by zero");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  parseUnary(): number {
    if (this.peek() === "-") {
      this.next();
      return -this.parseUnary();
    }
    if (this.peek() === "+") {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  }
  parsePower(): number {
    const base = this.parseAtom();
    if (this.peek() === "^") {
      this.next();
      const exp = this.parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }
  parseAtom(): number {
    const tok = this.next();
    if (tok === undefined) throw new ParseError("Unexpected end of expression");
    if (tok === "(") {
      const v = this.parseExpression();
      if (this.next() !== ")") throw new ParseError("Expected ')'");
      return v;
    }
    if (/^[0-9.]+$/.test(tok)) {
      const v = Number(tok);
      if (Number.isNaN(v)) throw new ParseError(`Invalid number '${tok}'`);
      return v;
    }
    if (/^[a-zA-Z]+$/.test(tok)) {
      const name = tok.toLowerCase();
      if (this.peek() === "(") {
        this.next();
        const arg = this.parseExpression();
        if (this.next() !== ")") throw new ParseError("Expected ')'");
        const fn = FUNCTIONS[name];
        if (!fn) throw new ParseError(`Unknown function '${name}'`);
        return fn(arg);
      }
      const c = CONSTANTS[name];
      if (c === undefined) throw new ParseError(`Unknown identifier '${name}'`);
      return c;
    }
    throw new ParseError(`Unexpected token '${tok}'`);
  }
}

export function evaluateExpression(expr: string): number {
  const parser = new Parser(tokenize(expr));
  const result = parser.parseExpression();
  if (parser.pos !== parser.tokens.length) {
    throw new ParseError(`Unexpected trailing input near '${parser.peek()}'`);
  }
  return result;
}
