import { describe, expect, it } from 'vitest';
import { freshLabels, LABEL_MAX, labelKey, parseList, sharedLabels, sharedTitle } from '../src/core/list';

describe('parseList', () => {
  it('takes a single line as written', () => {
    expect(parseList('  Tea  ')).toEqual(['Tea']);
    expect(parseList('- not a list')).toEqual(['- not a list']);
    expect(parseList('1. Paris')).toEqual(['1. Paris']);
    expect(parseList('Paris, France')).toEqual(['Paris, France']);
    expect(parseList('   ')).toEqual([]);
    expect(parseList('')).toEqual([]);
  });

  it('splits on line breaks of every kind, skipping blank lines', () => {
    expect(parseList('Tea\nCoffee\r\nCocoa\rMate')).toEqual(['Tea', 'Coffee', 'Cocoa', 'Mate']);
    expect(parseList('Tea\u2028Coffee')).toEqual(['Tea', 'Coffee']);
    expect(parseList('\n\nTea\n\n  \nCoffee\n')).toEqual(['Tea', 'Coffee']);
  });

  it('splits on escaped line breaks copied from code', () => {
    expect(parseList('Tea\\nCoffee\\r\\nCocoa')).toEqual(['Tea', 'Coffee', 'Cocoa']);
  });

  it('splits a spreadsheet row on tabs, and keeps the cells of a block together', () => {
    expect(parseList('Tea\tCoffee\tCocoa')).toEqual(['Tea', 'Coffee', 'Cocoa']);
    expect(parseList('Alien\t1979\nHeat\t1995')).toEqual(['Alien 1979', 'Heat 1995']);
  });

  it('reads Markdown lists: bullets, numbers, tasks, nesting', () => {
    expect(parseList('- Tea\n* Coffee\n+ Cocoa')).toEqual(['Tea', 'Coffee', 'Cocoa']);
    expect(parseList('1. Tea\n2) Coffee\n10. Cocoa')).toEqual(['Tea', 'Coffee', 'Cocoa']);
    expect(parseList('- [ ] Tea\n- [x] Coffee\n- [X] Cocoa\n[ ] Mate')).toEqual(['Tea', 'Coffee', 'Cocoa', 'Mate']);
    expect(parseList('- Hot\n  - Tea\n    1. Green')).toEqual(['Hot', 'Tea', 'Green']);
  });

  it('reads bullets as word processors and notes apps copy them', () => {
    expect(parseList('•\tTea\n• Coffee\n●Cocoa\no\tMate\n▪ Chai')).toEqual(['Tea', 'Coffee', 'Cocoa', 'Mate', 'Chai']);
    expect(parseList('– Tea\n— Coffee\n(1) Cocoa\na) Mate\nB) Chai')).toEqual([
      'Tea',
      'Coffee',
      'Cocoa',
      'Mate',
      'Chai',
    ]);
    expect(parseList('☐ Tea\n☑ Coffee')).toEqual(['Tea', 'Coffee']);
  });

  it('keeps what only looks like a marker', () => {
    expect(parseList('A. Lincoln\nG. Washington')).toEqual(['A. Lincoln', 'G. Washington']);
    expect(parseList('-5 °C\n+33\n*NSYNC\n2001: A Space Odyssey\n2.5 kg')).toEqual([
      '-5 °C',
      '+33',
      '*NSYNC',
      '2001: A Space Odyssey',
      '2.5 kg',
    ]);
  });

  it('leaves out the lines around a list: title, heading, note', () => {
    expect(parseList('## Films\nMy favorites:\n\n1. Alien\n2. Heat\n\nMore soon')).toEqual(['Alien', 'Heat']);
    expect(parseList('Fruits\n- Apple\n- Pear\nVegetables\n- Leek')).toEqual(['Apple', 'Pear', 'Leek']);
  });

  it('keeps every line when fewer than two are list items', () => {
    expect(parseList('Tea\n- Coffee\nCocoa')).toEqual(['Tea', 'Coffee', 'Cocoa']);
  });

  it('strips Markdown inside list items', () => {
    expect(
      parseList(
        '- **Alien** (1979)\n- [Heat](https://example.com/heat)\n- ![Ran](ran.jpg)\n- *Brazil*\n- `Tron` ~~2~~\n- 1\\. Up',
      ),
    ).toEqual(['Alien (1979)', 'Heat', 'Ran', 'Brazil', 'Tron 2', '1. Up']);
    expect(parseList('- M*A*S*H\n- snake_case_name')).toEqual(['M*A*S*H', 'snake_case_name']);
  });

  it('keeps Markdown-looking text in plain lines', () => {
    expect(parseList('**Alien**\n[Heat](x)')).toEqual(['**Alien**', '[Heat](x)']);
  });

  it('reads a JSON array of strings or numbers', () => {
    expect(parseList('["Tea", "Coffee", 3]')).toEqual(['Tea', 'Coffee', '3']);
    expect(parseList('[\n  "Tea",\n  " ",\n  "Coffee"\n]')).toEqual(['Tea', 'Coffee']);
    expect(parseList('[Draft]')).toEqual(['[Draft]']);
    expect(parseList('[{"a": 1}, "b"]')).toEqual(['[{"a": 1}, "b"]']);
  });

  it('cleans each label: invisible characters, inner spacing, length', () => {
    expect(parseList('\ufeffTea\u200b\nCoffee   with\tmilk')).toEqual(['Tea', 'Coffee with milk']);
    const long = parseList(`${'a'.repeat(200)}\nb`)[0] ?? '';
    expect(long).toHaveLength(LABEL_MAX);
    const emoji = parseList(`${'😀'.repeat(130)}\nb`)[0] ?? '';
    expect(Array.from(emoji)).toHaveLength(LABEL_MAX);
  });
});

describe('labelKey and freshLabels', () => {
  it('ignores case and spacing, and compares colors by value', () => {
    expect(labelKey('  Green   Tea ')).toBe(labelKey('green tea'));
    expect(labelKey('#FFF')).toBe(labelKey('#ffffff'));
    expect(labelKey('Café')).not.toBe(labelKey('Cafe'));
    expect(labelKey('Cafe\u0301')).toBe(labelKey('Café'));
  });

  it('keeps each new label once and counts the others', () => {
    expect(freshLabels(['Tea', 'coffee', 'TEA', 'Cocoa', '#2743f5'], ['Coffee', '#2743F5'])).toEqual({
      fresh: ['Tea', 'Cocoa'],
      dupes: 3,
    });
    expect(freshLabels([], ['Tea'])).toEqual({ fresh: [], dupes: 0 });
  });
});

describe('sharedLabels and sharedTitle', () => {
  const share = (over: Partial<{ title: string; text: string; url: string }>) => ({
    title: '',
    text: '',
    url: '',
    ...over,
  });

  it('reads a shared list like a paste', () => {
    const s = share({ title: 'Restaurants', text: 'Restaurants\n- Chez Paul\n- Le Bouillon\n- Mimosa' });
    expect(sharedLabels(s)).toEqual(['Chez Paul', 'Le Bouillon', 'Mimosa']);
    expect(sharedTitle(s)).toBe('Restaurants');
  });

  it("takes a page's title when the text is only its link, as browsers share", () => {
    const s = share({ title: 'Kyoto — Wikipedia', text: 'https://en.wikipedia.org/wiki/Kyoto' });
    expect(sharedLabels(s)).toEqual(['Kyoto — Wikipedia']);
    expect(sharedLabels(share({ text: 'https://example.com/a' }))).toEqual(['https://example.com/a']);
    expect(sharedLabels(share({ url: 'https://example.com/b' }))).toEqual(['https://example.com/b']);
  });

  it('keeps one line of text as one label, and nothing as nothing', () => {
    expect(sharedLabels(share({ title: 'Note', text: 'Lisbon in spring https://example.com' }))).toEqual([
      'Lisbon in spring https://example.com',
    ]);
    expect(sharedLabels(share({ text: '  ' }))).toEqual([]);
    expect(sharedLabels(share({ text: 'x'.repeat(200) }))[0]).toHaveLength(LABEL_MAX);
  });

  it('gives no title when the shared one is empty or a link', () => {
    expect(sharedTitle(share({}))).toBeNull();
    expect(sharedTitle(share({ title: 'https://example.com' }))).toBeNull();
    expect(sharedTitle(share({ title: 'T'.repeat(100) }))).toHaveLength(80);
  });
});
