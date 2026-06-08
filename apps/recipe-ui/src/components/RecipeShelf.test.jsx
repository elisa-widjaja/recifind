import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecipeShelf from './RecipeShelf';

const RECIPES = [
  { id: 'r1', title: 'Garlic Pasta', sourceUrl: '', imageUrl: '' },
  { id: 'r2', title: 'Thai Curry', sourceUrl: '', imageUrl: '' },
];

describe('RecipeShelf', () => {
  it('calls onSave when a card save icon is tapped', () => {
    const onSave = vi.fn();
    render(<RecipeShelf recipes={RECIPES} onSave={onSave} />);
    fireEvent.click(screen.getAllByLabelText('Save recipe')[0]);
    expect(onSave).toHaveBeenCalledWith(RECIPES[0]);
  });

  it('shows a "Saved" affordance for recipes whose id is in savedIds', () => {
    render(<RecipeShelf recipes={RECIPES} savedIds={new Set(['r1'])} />);
    expect(screen.getByLabelText('Saved')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Save recipe')).toHaveLength(1);
  });

  it('hides the share icon when hideShare is set', () => {
    render(<RecipeShelf recipes={RECIPES} hideShare />);
    expect(screen.queryByLabelText('Share recipe')).not.toBeInTheDocument();
  });

  it('shows the share icon by default', () => {
    render(<RecipeShelf recipes={RECIPES} />);
    expect(screen.getAllByLabelText('Share recipe')).toHaveLength(2);
  });
});
