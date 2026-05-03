import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BottomAppBar from './BottomAppBar';

describe('BottomAppBar', () => {
  const defaultProps = {
    activeTab: 'home',
    onTabChange: vi.fn(),
    onAddClick: vi.fn(),
    pendingFriendCount: 0,
  };

  it('renders all five tab labels', () => {
    render(<BottomAppBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recipes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /friends/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discover/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add recipe/i })).toBeInTheDocument();
  });

  it('marks the active tab as aria-selected', () => {
    render(<BottomAppBar {...defaultProps} activeTab="recipes" />);
    expect(screen.getByRole('button', { name: /recipes/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /home/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onTabChange with the tab id when a tab is clicked', () => {
    const onTabChange = vi.fn();
    render(<BottomAppBar {...defaultProps} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole('button', { name: /discover/i }));
    expect(onTabChange).toHaveBeenCalledWith('discover');
  });

  it('calls onAddClick when the FAB is tapped', () => {
    const onAddClick = vi.fn();
    render(<BottomAppBar {...defaultProps} onAddClick={onAddClick} />);
    fireEvent.click(screen.getByRole('button', { name: /add recipe/i }));
    expect(onAddClick).toHaveBeenCalled();
  });

  it('shows a pending-request badge on the Friends tab when pendingFriendCount > 0', () => {
    render(<BottomAppBar {...defaultProps} pendingFriendCount={3} />);
    expect(screen.getByLabelText(/3 pending friend requests/i)).toBeInTheDocument();
  });

  it('hides the pending badge when pendingFriendCount === 0', () => {
    render(<BottomAppBar {...defaultProps} pendingFriendCount={0} />);
    expect(screen.queryByLabelText(/pending friend requests/i)).not.toBeInTheDocument();
  });
});
