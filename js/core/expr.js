// Маленький парсер арифметичних виразів для шаблонів контенту.
// Підтримує: цілі числа, змінні (a, b, x1…), + - * / %, дужки,
// порівняння < > <= >= == != (результат true/false).
// Ділення має бути без остачі — інакше крок вважається некоректним.

const OPERATORS = ['<=', '>=', '==', '!=', '<', '>', '+', '-', '*', '/', '%', '(', ')'];

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ') { i++; continue; }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9]/.test(source[j])) j++;
      tokens.push({ type: 'num', value: Number(source.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z_0-9]/.test(source[j])) j++;
      tokens.push({ type: 'var', value: source.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (!op) throw new Error(`Невідомий символ «${ch}» у виразі «${source}»`);
    tokens.push({ type: 'op', value: op });
    i += op.length;
  }
  return tokens;
}

// Граматика (за зростанням пріоритету):
//   comparison := sum (cmpOp sum)?
//   sum        := product (('+'|'-') product)*
//   product    := unary (('*'|'/'|'%') unary)*
//   unary      := '-' unary | primary
//   primary    := num | var | '(' comparison ')'
export function parse(source) {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (...ops) => peek()?.type === 'op' && ops.includes(peek().value);

  function comparison() {
    const left = sum();
    if (isOp('<', '>', '<=', '>=', '==', '!=')) {
      const op = tokens[pos++].value;
      return { type: 'bin', op, left, right: sum() };
    }
    return left;
  }
  function sum() {
    let node = product();
    while (isOp('+', '-')) {
      const op = tokens[pos++].value;
      node = { type: 'bin', op, left: node, right: product() };
    }
    return node;
  }
  function product() {
    let node = unary();
    while (isOp('*', '/', '%')) {
      const op = tokens[pos++].value;
      node = { type: 'bin', op, left: node, right: unary() };
    }
    return node;
  }
  function unary() {
    if (isOp('-')) { pos++; return { type: 'neg', arg: unary() }; }
    return primary();
  }
  function primary() {
    const t = tokens[pos++];
    if (!t) throw new Error(`Неочікуваний кінець виразу «${source}»`);
    if (t.type === 'num') return { type: 'num', value: t.value };
    if (t.type === 'var') return { type: 'var', name: t.value };
    if (t.value === '(') {
      const node = comparison();
      if (!isOp(')')) throw new Error(`Бракує «)» у виразі «${source}»`);
      pos++;
      return { type: 'paren', arg: node };
    }
    throw new Error(`Неочікуваний «${t.value}» у виразі «${source}»`);
  }

  const ast = comparison();
  if (pos < tokens.length) throw new Error(`Зайві символи у виразі «${source}»`);
  return ast;
}

// Обчислює вираз. Повертає { value, steps, valid }:
//   steps — проміжні результати кожної арифметичної дії (для обмежень
//   «у межах 100»), valid=false якщо ділення з остачею або на нуль.
export function evaluate(source, vars = {}) {
  const ast = typeof source === 'string' ? parse(source) : source;
  const steps = [];
  let valid = true;

  function ev(node) {
    switch (node.type) {
      case 'num': return node.value;
      case 'paren': return ev(node.arg);
      case 'neg': return -ev(node.arg);
      case 'var': {
        if (!(node.name in vars)) throw new Error(`Невідома змінна «${node.name}»`);
        return vars[node.name];
      }
      case 'bin': {
        const l = ev(node.left);
        const r = ev(node.right);
        switch (node.op) {
          case '+': return step(l + r);
          case '-': return step(l - r);
          case '*': return step(l * r);
          case '/':
            if (r === 0 || l % r !== 0) valid = false;
            return step(r === 0 ? NaN : l / r);
          case '%': return r === 0 ? NaN : l % r;
          case '<': return l < r;
          case '>': return l > r;
          case '<=': return l <= r;
          case '>=': return l >= r;
          case '==': return l === r;
          case '!=': return l !== r;
        }
      }
    }
    throw new Error('Некоректний вузол виразу');
  }
  function step(v) { steps.push(v); return v; }

  const value = ev(ast);
  return { value, steps, valid };
}

// Вираз у «шкільному» записі: 12 + 5 × 3, 18 : 2, 40 − 7.
const DISPLAY_OPS = { '*': '×', '/': ':', '-': '−' };

export function formatExpression(source, vars = {}) {
  return tokenize(source)
    .map((t) => {
      if (t.type === 'num') return String(t.value);
      if (t.type === 'var') return String(vars[t.value] ?? t.value);
      return DISPLAY_OPS[t.value] ?? t.value;
    })
    .join(' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');
}
