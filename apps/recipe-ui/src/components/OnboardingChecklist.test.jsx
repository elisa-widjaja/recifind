import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OnboardingChecklist from './OnboardingChecklist';

describe('OnboardingChecklist', () => {
  it('renders all 3 step labels', () => {
    render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSharedRecipe={false} />);
    expect(screen.getByText(/add your first recipe/i)).toBeInTheDocument();
    expect(screen.getByText(/invite a friend/i)).toBeInTheDocument();
    expect(screen.getByText(/share a recipe with a friend/i)).toBeInTheDocument();
  });

  it('shows N of 3 counter reflecting completed steps', () => {
    render(<OnboardingChecklist hasRecipe hasInvitedFriend={false} hasSharedRecipe={false} />);
    expect(screen.getByText(/1 of 3/i)).toBeInTheDocument();
  });

  it('renders nothing when all 3 are complete', () => {
    const { container } = render(<OnboardingChecklist hasRecipe hasInvitedFriend hasSharedRecipe />);
    expect(container.firstChild).toBeNull();
  });

  it('marks completed steps with the data-done attribute', () => {
    render(<OnboardingChecklist hasRecipe hasInvitedFriend={false} hasSharedRecipe={false} />);
    const recipeStep = screen.getByText(/add your first recipe/i).closest('[data-step]');
    expect(recipeStep).toHaveAttribute('data-done', 'true');
    const inviteStep = screen.getByText(/invite a friend/i).closest('[data-step]');
    expect(inviteStep).toHaveAttribute('data-done', 'false');
  });

  it('does NOT render the horizontal progress bar', () => {
    const { container } = render(<OnboardingChecklist hasRecipe hasInvitedFriend={false} hasSharedRecipe={false} />);
    // The old progress bar was a Box with width: '33%' (or similar pct).
    // Asserting no element with width style ending in '%' exists below the
    // checklist root.
    const inlinePctWidths = container.querySelectorAll('[style*="width: 33%"], [style*="width: 67%"], [style*="width: 100%"]');
    expect(inlinePctWidths.length).toBe(0);
  });

  it('collapses the steps list when the header toggle is tapped', () => {
    render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSharedRecipe={false} />);
    const toggle = screen.getByRole('button', { name: /collapse checklist/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    // After click, button label flips and aria-expanded reflects collapsed
    expect(screen.getByRole('button', { name: /expand checklist/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a dismiss button only when onDismiss is provided', () => {
    const { rerender } = render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSharedRecipe={false} />);
    expect(screen.queryByRole('button', { name: /dismiss checklist/i })).not.toBeInTheDocument();

    rerender(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSharedRecipe={false} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: /dismiss checklist/i })).toBeInTheDocument();
  });

  it('calls onDismiss when the dismiss button is tapped', () => {
    const onDismiss = vi.fn();
    render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSharedRecipe={false} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss checklist/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
