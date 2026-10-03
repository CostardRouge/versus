import { describe, expect, it, vi } from 'vitest';
import { render, setRender } from '../src/app/nav';

describe('nav', () => {
  it('draws the view through the render the app hands over, and nothing before', () => {
    expect(() => render()).not.toThrow();
    const draw = vi.fn();
    setRender(draw);
    const fallback = () => null;
    render(fallback);
    render();
    expect(draw.mock.calls).toEqual([[fallback], [undefined]]);
  });
});
