/**
 * UI · primitives.ts
 * The design system's component surface, re-exported so screens never import the
 * vendor package directly (§8.1).
 *
 * This is what makes "swapping the underlying components never changes the
 * screens" true rather than aspirational: every primitive a screen can reach is
 * listed here, so replacing or re-theming the library is a change to this
 * package alone. The competitor-names fitness rule enforces it — an import of
 * the vendor package anywhere outside packages/ui fails the build.
 * Layer: ui.
 */

export {
  // Layout
  Page,
  Layout,
  Card,
  Box,
  BlockStack,
  InlineStack,
  InlineGrid,
  Divider,
  // Typography and status
  Text,
  Badge,
  Banner,
  Link,
  Tag,
  // Controls
  Button,
  ButtonGroup,
  Checkbox,
  Select,
  TextField,
  RadioButton,
  Spinner,
  // Data
  IndexTable,
  IndexFilters,
  DataTable,
  Pagination,
  EmptySearchResult,
  EmptyState,
  ResourceList,
  ResourceItem,
  // Overlays and chrome
  Modal,
  Frame,
  Navigation,
  TopBar,
  ContextualSaveBar,
  Toast,
  Popover,
  ActionList,
  // Hooks
  useIndexResourceState,
  useSetIndexFiltersMode,
  useBreakpoints,
  AppProvider,
} from '@shopify/polaris';

export type {
  BannerProps,
  ButtonProps,
  IndexTableProps,
  ModalProps,
  SelectProps,
  TextFieldProps,
} from '@shopify/polaris';
