import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShareSheet } from './ShareSheet';

describe('ShareSheet', () => {
  it('does not render contents when closed', () => {
    render(<ShareSheet open={false} onClose={() => {}} onPickFriends={() => {}} onPickConnections={() => {}} />);
    expect(screen.queryByText(/Share with Friends/i)).not.toBeInTheDocument();
  });

  it('renders both share rows when open', () => {
    render(<ShareSheet open onClose={() => {}} onPickFriends={() => {}} onPickConnections={() => {}} />);
    expect(screen.getByText(/Share with Friends/i)).toBeInTheDocument();
    expect(screen.getByText(/Share with Connections/i)).toBeInTheDocument();
  });

  it('clicking "Share with Friends" calls onPickFriends', () => {
    const onPickFriends = vi.fn();
    render(<ShareSheet open onClose={() => {}} onPickFriends={onPickFriends} onPickConnections={() => {}} />);
    fireEvent.click(screen.getByText(/Share with Friends/i));
    expect(onPickFriends).toHaveBeenCalledTimes(1);
  });

  it('clicking "Share with Connections" calls onPickConnections', () => {
    const onPickConnections = vi.fn();
    render(<ShareSheet open onClose={() => {}} onPickFriends={() => {}} onPickConnections={onPickConnections} />);
    fireEvent.click(screen.getByText(/Share with Connections/i));
    expect(onPickConnections).toHaveBeenCalledTimes(1);
  });
});
