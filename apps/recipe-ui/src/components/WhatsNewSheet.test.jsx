import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WhatsNewSheet from './WhatsNewSheet';

const tips = [
  { id: 'a', title: 'Search community recipes', body: 'Search by ingredient or creator.', action: 'discover' },
  { id: 'b', title: "See your friends' friends", body: 'Open a friend and tap Friends.', action: 'friends' },
];

describe('WhatsNewSheet', () => {
  it('does not render contents when closed', () => {
    render(<WhatsNewSheet open={false} tips={tips} onTry={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("What's new")).not.toBeInTheDocument();
  });

  it('renders the title and every tip when open', () => {
    render(<WhatsNewSheet open tips={tips} onTry={() => {}} onClose={() => {}} />);
    expect(screen.getByText("What's new")).toBeInTheDocument();
    for (const tip of tips) {
      expect(screen.getByText(tip.title)).toBeInTheDocument();
      expect(screen.getByText(tip.body)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /try it/i })).toHaveLength(tips.length);
  });

  it('"Try it" calls onTry with that tip', () => {
    const onTry = vi.fn();
    render(<WhatsNewSheet open tips={tips} onTry={onTry} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: /try it/i })[1]);
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(onTry).toHaveBeenCalledWith(tips[1]);
  });

  it('"Got it" and the close button call onClose', () => {
    const onClose = vi.fn();
    render(<WhatsNewSheet open tips={tips} onTry={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
