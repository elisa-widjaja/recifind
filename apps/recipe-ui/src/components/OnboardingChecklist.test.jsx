import { describe, expect, it } from 'vitest';
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

  it('starts EXPANDED when fewer than 2 steps are done (new user)', () => {
    render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSharedRecipe={false} />);
    expect(screen.getByRole('button', { name: /collapse checklist/i }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('starts COLLAPSED once 2 of 3 steps are done', () => {
    render(<OnboardingChecklist hasRecipe hasInvitedFriend hasSharedRecipe={false} />);
    expect(screen.getByRole('button', { name: /expand checklist/i }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('the user can collapse it for the session', () => {
    render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSharedRecipe={false} />);
    const toggle = screen.getByRole('button', { name: /collapse checklist/i });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /expand checklist/i }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('has no dismiss control (self-removes only at 3/3)', () => {
    render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSharedRecipe={false} />);
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });
});
