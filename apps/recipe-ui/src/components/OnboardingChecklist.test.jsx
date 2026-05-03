import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import OnboardingChecklist from './OnboardingChecklist';

describe('OnboardingChecklist', () => {
  it('renders all 3 step labels', () => {
    render(<OnboardingChecklist hasRecipe={false} hasInvitedFriend={false} hasSavedFriendRecipe={false} />);
    expect(screen.getByText(/add your first recipe/i)).toBeInTheDocument();
    expect(screen.getByText(/invite a friend/i)).toBeInTheDocument();
    expect(screen.getByText(/save a friend's recipe/i)).toBeInTheDocument();
  });

  it('shows N of 3 counter reflecting completed steps', () => {
    render(<OnboardingChecklist hasRecipe hasInvitedFriend={false} hasSavedFriendRecipe={false} />);
    expect(screen.getByText(/1 of 3/i)).toBeInTheDocument();
  });

  it('renders nothing when all 3 are complete', () => {
    const { container } = render(<OnboardingChecklist hasRecipe hasInvitedFriend hasSavedFriendRecipe />);
    expect(container.firstChild).toBeNull();
  });

  it('marks completed steps with the data-done attribute', () => {
    render(<OnboardingChecklist hasRecipe hasInvitedFriend={false} hasSavedFriendRecipe={false} />);
    const recipeStep = screen.getByText(/add your first recipe/i).closest('[data-step]');
    expect(recipeStep).toHaveAttribute('data-done', 'true');
    const inviteStep = screen.getByText(/invite a friend/i).closest('[data-step]');
    expect(inviteStep).toHaveAttribute('data-done', 'false');
  });
});
