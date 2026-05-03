import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfilePage from './ProfilePage';

const baseProps = {
  user: { displayName: 'Elisa Widjaja', email: 'elisa@example.com' },
  themePref: 'system',
  onThemeChange: vi.fn(),
  onEditName: vi.fn(),
  onEditAvatar: vi.fn(),
  onEditCookingPrefs: vi.fn(),
  onSendFeedback: vi.fn(),
  onOpenAbout: vi.fn(),
  onPrivacy: vi.fn(),
  onSignOut: vi.fn(),
  notificationsEnabled: true,
};

describe('ProfilePage', () => {
  it('renders the user display name and email', () => {
    render(<ProfilePage {...baseProps} />);
    expect(screen.getByText('Elisa Widjaja')).toBeInTheDocument();
    expect(screen.getByText('elisa@example.com')).toBeInTheDocument();
  });

  it('falls back to email username when displayName is empty', () => {
    render(<ProfilePage {...baseProps} user={{ email: 'foo@example.com' }} />);
    expect(screen.getByText('foo')).toBeInTheDocument();
  });

  it('renders all setting/more rows including Privacy', () => {
    render(<ProfilePage {...baseProps} />);
    expect(screen.getByText(/cooking preferences/i)).toBeInTheDocument();
    expect(screen.getByText(/notifications/i)).toBeInTheDocument();
    expect(screen.getByText(/send feedback/i)).toBeInTheDocument();
    expect(screen.getByText(/about/i)).toBeInTheDocument();
    expect(screen.getByText(/privacy/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('calls onPrivacy when Privacy row is clicked', () => {
    const onPrivacy = vi.fn();
    render(<ProfilePage {...baseProps} onPrivacy={onPrivacy} />);
    fireEvent.click(screen.getByText(/privacy/i));
    expect(onPrivacy).toHaveBeenCalled();
  });

  it('shows the active theme as selected in the segmented control', () => {
    render(<ProfilePage {...baseProps} themePref="dark" />);
    expect(screen.getByRole('button', { name: /dark/i, pressed: true })).toBeInTheDocument();
  });

  it('calls onThemeChange("light") when Light is clicked', () => {
    const onThemeChange = vi.fn();
    render(<ProfilePage {...baseProps} onThemeChange={onThemeChange} themePref="system" />);
    fireEvent.click(screen.getByRole('button', { name: /light/i }));
    expect(onThemeChange).toHaveBeenCalledWith('light');
  });

  it('calls onSignOut when Sign out is clicked', () => {
    const onSignOut = vi.fn();
    render(<ProfilePage {...baseProps} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('calls onEditCookingPrefs when Cooking preferences row is clicked', () => {
    const onEditCookingPrefs = vi.fn();
    render(<ProfilePage {...baseProps} onEditCookingPrefs={onEditCookingPrefs} />);
    fireEvent.click(screen.getByText(/cooking preferences/i));
    expect(onEditCookingPrefs).toHaveBeenCalled();
  });
});
