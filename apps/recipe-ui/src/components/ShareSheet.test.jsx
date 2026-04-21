import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShareSheet } from './ShareSheet';

describe('ShareSheet', () => {
  it('does not render contents when closed', () => {
    render(<ShareSheet open={false} onClose={() => {}} onPickFriends={() => {}} onPickConnections={() => {}} />);
    expect(screen.queryByText('Share with')).not.toBeInTheDocument();
  });

  it('renders both share tiles when open', () => {
    render(<ShareSheet open onClose={() => {}} onPickFriends={() => {}} onPickConnections={() => {}} />);
    expect(screen.getByText('Share with')).toBeInTheDocument();
    expect(screen.getByText('Friends')).toBeInTheDocument();
    expect(screen.getByText('Connections')).toBeInTheDocument();
  });

  it('clicking the Friends tile calls onPickFriends', () => {
    const onPickFriends = vi.fn();
    render(<ShareSheet open onClose={() => {}} onPickFriends={onPickFriends} onPickConnections={() => {}} />);
    fireEvent.click(screen.getByText('Friends'));
    expect(onPickFriends).toHaveBeenCalledTimes(1);
  });

  it('clicking the Connections tile calls onPickConnections', () => {
    const onPickConnections = vi.fn();
    render(<ShareSheet open onClose={() => {}} onPickFriends={() => {}} onPickConnections={onPickConnections} />);
    fireEvent.click(screen.getByText('Connections'));
    expect(onPickConnections).toHaveBeenCalledTimes(1);
  });
});
