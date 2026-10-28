# Зводить усі підказки з data/ в один документ docs/HINTS-CATALOG.md.
# Джерело правди — JSON у data/topics; після змін підказок запустіть знову:
#   python3 tools/hints_report.py

import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LEVELS_FALLBACK = {'1': 'Легко', '2': 'Середньо', '3': 'Складно'}


def load(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return json.load(f)


def hint_md(hint):
    """Підказка (рядок або { rules, scheme }) → текст для клітинки таблиці."""
    if not hint:
        return None
    if isinstance(hint, str):
        return hint
    parts = [f'• {r}' for r in hint.get('rules', [])]
    parts += [f'📐 *{l}*' for l in hint.get('scheme', [])]
    return '<br>'.join(parts)


def main():
    catalog = load('data/catalog.json')
    levels = catalog.get('levels', LEVELS_FALLBACK)
    lines = [
        '# Каталог підказок',
        '',
        'Згенеровано з `data/topics/*.json` скриптом `tools/hints_report.py`. Редагуйте підказки в JSON, а потім перегенеруйте цей файл.',
        '',
        'У таблицях: **завдання** — ідентифікатор і рівень; «*(з розділу)*» означає, що в завдання немає своєї підказки і показується підказка розділу. Правила позначено «•», схему назв — «📐» курсивом.',
        '',
    ]
    for grade in catalog['grades']:
        if not grade.get('topics'):
            continue
        lines += [f"## {grade['title']}", '']
        for path in grade['topics']:
            topic = load(os.path.join('data', path))
            lines += [f"### {topic.get('icon', '')} {topic['title']}", '']
            lines += [f"**Підказка розділу:**<br>{hint_md(topic.get('hint')) or '— немає —'}", '']
            lines += ['| Завдання | Рівень | Підказка |', '|---|---|---|']
            for ex in topic['exercises']:
                level = levels.get(str(ex.get('difficulty', 1)), str(ex.get('difficulty', 1)))
                hint = hint_md(ex.get('hint')) or '*(з розділу)*'
                lines.append(f"| `{ex['id']}` | {level} | {hint.replace('|', '\\|')} |")
            lines.append('')
    out = os.path.join(ROOT, 'docs', 'HINTS-CATALOG.md')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Записано {out}')


if __name__ == '__main__':
    main()
