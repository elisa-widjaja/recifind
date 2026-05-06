import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecipesPage from './RecipesPage';

const noop = () => {};
const baseProps = {
  displayedRecipes: [],
  filteredRecipes: [{ id: '1' }, { id: '2' }, { id: '3' }],
  totalRecipes: 3,
  accessToken: 'tok',
  ingredientInput: '',
  setIngredientInput: noop,
  ingredientInputKeyCount: 0,
  showIngredientSuggestions: false,
  filteredIngredientSuggestions: [],
  ingredientSuggestionFormatter: (s) => s,
  handleIngredientInputChange: noop,
  handleIngredientSuggestionClick: noop,
  setIngredientInputFocused: noop,
  setIngredientInputKeyCount: noop,
  normalizedIngredients: [],
  isMobile: true,
  searchBarRef: { current: null },
  handleOpenRecipe: noop,
  toggleFavorite: noop,
  handleShare: noop,
  handleVideoThumbnailClick: noop,
  onAddRecipe: noop,
  addRecipeBtnRef: { current: null },
  session: { user: { id: 'u1' } },
  favorites: new Set(),
  openAuthDialog: noop,
  remoteState: { status: 'idle' },
  resolveRecipeImageUrl: () => '',
  buildEmbedUrl: () => null,
  sentinelRef: { current: null },
  availableMealTypes: ['breakfast', 'lunch', 'dinner'],
  selectedMealType: '',
  onMealTypeSelect: vi.fn(),
  showFavoritesOnly: false,
  onToggleFavoritesOnly: vi.fn(),
};

describe('RecipesPage filter drawer', () => {
  it('renders the Filters icon button on the results row', () => {
    render(<RecipesPage {...baseProps} />);
    expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
  });

  it('does not render meal-type chips inline (they live in the drawer)', () => {
    render(<RecipesPage {...baseProps} />);
    // Chips are inside a Drawer that's closed by default — should not be in DOM.
    expect(screen.queryByRole('button', { name: /breakfast/i })).not.toBeInTheDocument();
  });

  it('opens the drawer with all meal-type chips when Filters is tapped', () => {
    render(<RecipesPage {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByRole('button', { name: /breakfast/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lunch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dinner/i })).toBeInTheDocument();
  });

  it('calls onMealTypeSelect when a chip inside the drawer is tapped', () => {
    const onMealTypeSelect = vi.fn();
    render(<RecipesPage {...baseProps} onMealTypeSelect={onMealTypeSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /lunch/i }));
    expect(onMealTypeSelect).toHaveBeenCalledWith('lunch');
  });

  it('shows selectedMealType chip as aria-pressed=true inside the drawer', () => {
    render(<RecipesPage {...baseProps} selectedMealType="dinner" />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByRole('button', { name: /dinner/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders favorites toggle inside the drawer with active state', () => {
    render(<RecipesPage {...baseProps} showFavoritesOnly />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByRole('button', { name: /^favorites$/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
