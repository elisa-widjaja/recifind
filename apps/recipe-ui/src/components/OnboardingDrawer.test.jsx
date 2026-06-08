import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChecklistScreen } from './OnboardingDrawer';

const RECIPES = [
  { id: 'r1', title: 'Garlic Pasta', sourceUrl: '', imageUrl: '' },
  { id: 'r2', title: 'Thai Curry', sourceUrl: '', imageUrl: '' },
];

describe('ChecklistScreen', () => {
  it('renders the three checklist step labels', () => {
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByText(/save your first recipe/i)).toBeInTheDocument();
    expect(screen.getByText(/invite a friend/i)).toBeInTheDocument();
    expect(screen.getByText(/share a recipe with a friend/i)).toBeInTheDocument();
  });

  it('renders a tap-to-save carousel card for each recipe under step 1', () => {
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByText('Garlic Pasta')).toBeInTheDocument();
    expect(screen.getByText('Thai Curry')).toBeInTheDocument();
  });

  it('shows "Skip for now" (not "Get started") when nothing is saved yet', () => {
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^get started$/i })).not.toBeInTheDocument();
  });

  it('swaps to a primary "Get started" once at least one recipe is saved', () => {
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set(['r1'])} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByRole('button', { name: /^get started$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip for now/i })).not.toBeInTheDocument();
  });

  it('marks step 1 done (data-done=true) once a recipe is saved', () => {
    const { rerender } = render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByText(/save your first recipe/i).closest('[data-step]')).toHaveAttribute('data-done', 'false');
    rerender(<ChecklistScreen recipes={RECIPES} savedIds={new Set(['r1'])} onSave={() => {}} onGetStarted={() => {}} />);
    expect(screen.getByText(/save your first recipe/i).closest('[data-step]')).toHaveAttribute('data-done', 'true');
  });

  it('fires onSave when a card save icon is tapped', () => {
    const onSave = vi.fn();
    render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={onSave} onGetStarted={() => {}} />);
    fireEvent.click(screen.getAllByLabelText('Save recipe')[0]);
    expect(onSave).toHaveBeenCalledWith(RECIPES[0]);
  });

  it('calls onGetStarted from both the skip and the get-started states', () => {
    const onGetStarted = vi.fn();
    const { rerender } = render(<ChecklistScreen recipes={RECIPES} savedIds={new Set()} onSave={() => {}} onGetStarted={onGetStarted} />);
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    rerender(<ChecklistScreen recipes={RECIPES} savedIds={new Set(['r1'])} onSave={() => {}} onGetStarted={onGetStarted} />);
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }));
    expect(onGetStarted).toHaveBeenCalledTimes(2);
  });
});
