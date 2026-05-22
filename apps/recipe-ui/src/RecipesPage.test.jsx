import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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
  selectedMealTypes: [],
  onMealTypeToggle: vi.fn(),
  onClearMealTypes: vi.fn(),
  availableCuisines: [],
  selectedCuisines: [],
  onCuisineToggle: vi.fn(),
  onClearCuisines: vi.fn(),
  selectedTags: [],
  onTagToggle: vi.fn(),
  onClearTags: vi.fn(),
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

  it('calls onMealTypeToggle when a meal-type chip inside the drawer is tapped', () => {
    const onMealTypeToggle = vi.fn();
    render(<RecipesPage {...baseProps} onMealTypeToggle={onMealTypeToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /lunch/i }));
    expect(onMealTypeToggle).toHaveBeenCalledWith('lunch');
  });

  it('marks every selected meal type as aria-pressed=true (multi-select)', () => {
    render(<RecipesPage {...baseProps} selectedMealTypes={['lunch', 'dinner']} />);
    fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
    expect(screen.getByRole('button', { name: /lunch/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /dinner/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /breakfast/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the drawer open after a meal-type chip is tapped (no auto-dismiss)', () => {
    vi.useFakeTimers();
    try {
      render(<RecipesPage {...baseProps} />);
      act(() => { fireEvent.click(screen.getByRole('button', { name: /filters/i })); });
      act(() => { vi.runOnlyPendingTimers(); }); // flush drawer open transition
      fireEvent.click(screen.getByRole('button', { name: /lunch/i }));
      // Old behavior auto-dismissed after 750ms; new behavior must stay open.
      act(() => { vi.advanceTimersByTime(1500); });
      expect(screen.getByRole('button', { name: /lunch/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders cuisine chips and toggles them (multi-select)', () => {
    const onCuisineToggle = vi.fn();
    render(
      <RecipesPage
        {...baseProps}
        availableCuisines={['italian', 'mexican']}
        selectedCuisines={['italian']}
        onCuisineToggle={onCuisineToggle}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
    expect(screen.getByRole('button', { name: /italian/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /mexican/i })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /mexican/i }));
    expect(onCuisineToggle).toHaveBeenCalledWith('mexican');
  });

  it('renders a "Show N recipes" button that closes the drawer', async () => {
    render(<RecipesPage {...baseProps} filteredRecipes={[{ id: '1' }, { id: '2' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
    const showBtn = screen.getByRole('button', { name: /show 2 recipes/i });
    expect(showBtn).toBeInTheDocument();
    fireEvent.click(showBtn);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /breakfast/i })).not.toBeInTheDocument();
    });
  });

  it('hides the drawer-header Clear filters link when no filter is active', () => {
    render(<RecipesPage {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it('shows a Clear filters link in the drawer header when a filter is active', () => {
    const onClearMealTypes = vi.fn();
    render(<RecipesPage {...baseProps} selectedMealTypes={['lunch']} onClearMealTypes={onClearMealTypes} />);
    fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
    // The results-row link is aria-hidden behind the open drawer, so the only
    // accessible "Clear filters" is the drawer-header one. Clicking it clears.
    const clearLink = screen.getByRole('button', { name: /clear filters/i });
    fireEvent.click(clearLink);
    expect(onClearMealTypes).toHaveBeenCalled();
  });

  it('renders favorites toggle inside the drawer with active state', () => {
    render(<RecipesPage {...baseProps} showFavoritesOnly />);
    fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
    expect(screen.getByRole('button', { name: /^favorites$/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
