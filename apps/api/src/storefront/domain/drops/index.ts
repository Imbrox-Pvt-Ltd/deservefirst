/**
 * Storefront · domain/drops/index.ts
 * Every drop a theme can be handed.
 *
 * Importing from here is what registers them, which is what makes
 * `declaredDrops()` complete — and the audit that reads it meaningful. A drop
 * defined in a file nobody imports is a drop nobody reviewed.
 * Layer: domain (pure).
 */

export {
  createDropContext,
  declaredDrops,
  defineDrop,
  dropList,
  type DropContext,
  type DropFactory,
} from './define';

export {
  collectionDrop,
  imageDrop,
  productDrop,
  variantDrop,
  type CollectionRow,
  type ImageRow,
  type ProductRow,
  type VariantRow,
} from './catalog';

export {
  linkDrop,
  linklistDrop,
  paginateDrop,
  requestDrop,
  shopDrop,
  templateDrop,
  type LinkRow,
  type LinklistRow,
  type PaginateState,
  type RequestState,
  type ShopRow,
  type TemplateState,
} from './global';

export {
  articleDrop,
  blogDrop,
  commentDrop,
  pageDrop,
  type ArticleRow,
  type BlogRow,
  type CommentRow,
  type PageRow,
} from './content';

export {
  addressDrop,
  cartDrop,
  customerDrop,
  lineItemDrop,
  orderDrop,
  type AddressRow,
  type CartRow,
  type CustomerRow,
  type LineItemRow,
  type OrderRow,
} from './commerce';

export {
  blockDrop,
  formDrop,
  searchDrop,
  sectionDrop,
  settingsWithDefaults,
  type BlockState,
  type FormState,
  type SearchState,
  type SectionState,
} from './theme';
