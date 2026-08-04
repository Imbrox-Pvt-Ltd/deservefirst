-- 0001 · baseline schema
--
-- Applied once, in order, and never edited afterwards: the runner stores this
-- file's checksum and refuses to continue if it changes.
--
-- Destructive changes (DROP, MODIFY, RENAME) belong here, written deliberately,
-- and follow expand → migrate → contract (§17.2): add the new shape, move the
-- data while both exist, and remove the old one in a LATER migration once
-- nothing reads it.

CREATE TABLE IF NOT EXISTS `platform_module_states` (
  `id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `module_id` VARCHAR(255) NOT NULL,
  `enabled` TINYINT(1) NULL,
  `reason` MEDIUMTEXT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_platform_module_states_handle ON `platform_module_states` (`handle`);
CREATE TABLE IF NOT EXISTS `platform_module_states_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_platform_module_states_tl ON `platform_module_states_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `store_module_states` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `module_id` VARCHAR(255) NOT NULL,
  `enabled` TINYINT(1) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_store_module_states_scope ON `store_module_states` (`store_id`);
CREATE INDEX idx_store_module_states_scope_created ON `store_module_states` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_store_module_states_scope_handle ON `store_module_states` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `store_module_states_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_store_module_states_tl ON `store_module_states_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `platform_settings` (
  `id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `setting_key` VARCHAR(255) NOT NULL,
  `value` JSON NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_platform_settings_handle ON `platform_settings` (`handle`);
CREATE TABLE IF NOT EXISTS `platform_settings_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_platform_settings_tl ON `platform_settings_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `store_settings` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `setting_key` VARCHAR(255) NOT NULL,
  `value` JSON NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_store_settings_scope ON `store_settings` (`store_id`);
CREATE INDEX idx_store_settings_scope_created ON `store_settings` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_store_settings_scope_handle ON `store_settings` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `store_settings_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_store_settings_tl ON `store_settings_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(255) NULL,
  `last_name` VARCHAR(255) NULL,
  `status` VARCHAR(64) NULL,
  `secondary_email` VARCHAR(255) NULL,
  `email_verified_at` DATETIME(3) NULL,
  `mfa_enabled` TINYINT(1) NULL,
  `locale` VARCHAR(255) NULL,
  `time_zone` VARCHAR(255) NULL,
  `provider_ref` VARCHAR(255) NULL,
  `password_hash` MEDIUMTEXT NULL,
  `mfa_secret` MEDIUMTEXT NULL,
  `recovery_code_hashes` JSON NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_users_handle ON `users` (`handle`);
CREATE TABLE IF NOT EXISTS `users_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_users_tl ON `users_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `organizations` (
  `id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `name` VARCHAR(255) NOT NULL,
  `require_secure_sign_in` TINYINT(1) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_organizations_handle ON `organizations` (`handle`);
CREATE TABLE IF NOT EXISTS `organizations_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_organizations_tl ON `organizations_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `user_id` VARCHAR(64) NULL,
  `store_id` VARCHAR(64) NULL,
  `organization_id` VARCHAR(64) NULL,
  `refresh_token_hash` VARCHAR(255) NULL,
  `device_label` VARCHAR(255) NULL,
  `ip_address` VARCHAR(255) NULL,
  `user_agent` MEDIUMTEXT NULL,
  `last_seen_at` DATETIME(3) NULL,
  `expires_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_sessions_handle ON `sessions` (`handle`);
CREATE TABLE IF NOT EXISTS `login_flows` (
  `id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `rid` VARCHAR(255) NULL,
  `step` VARCHAR(64) NULL,
  `email` VARCHAR(255) NULL,
  `user_id` VARCHAR(64) NULL,
  `return_path` VARCHAR(255) NULL,
  `attempts` INT NULL,
  `expires_at` DATETIME(3) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_login_flows_handle ON `login_flows` (`handle`);
CREATE TABLE IF NOT EXISTS `business_entities` (
  `id` VARCHAR(64) NOT NULL,
  `organization_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `name` VARCHAR(255) NOT NULL,
  `country_code` VARCHAR(255) NOT NULL,
  `company_type` VARCHAR(255) NULL,
  `tax_registration_id` VARCHAR(255) NULL,
  `archived_at` DATETIME(3) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_business_entities_scope ON `business_entities` (`organization_id`);
CREATE INDEX idx_business_entities_scope_created ON `business_entities` (`organization_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_business_entities_scope_handle ON `business_entities` (`organization_id`, `handle`);
CREATE TABLE IF NOT EXISTS `business_entities_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_business_entities_tl ON `business_entities_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `stores` (
  `id` VARCHAR(64) NOT NULL,
  `organization_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `name` VARCHAR(255) NOT NULL,
  `business_entity_id` VARCHAR(64) NULL,
  `type` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  `default_locale` VARCHAR(255) NULL,
  `time_zone` VARCHAR(255) NULL,
  `base_currency` VARCHAR(255) NULL,
  `feature_previews` JSON NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_stores_scope ON `stores` (`organization_id`);
CREATE INDEX idx_stores_scope_created ON `stores` (`organization_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_stores_scope_handle ON `stores` (`organization_id`, `handle`);
CREATE TABLE IF NOT EXISTS `stores_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_stores_tl ON `stores_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `memberships` (
  `id` VARCHAR(64) NOT NULL,
  `organization_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `user_id` VARCHAR(64) NULL,
  `store_id` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  `invited_by` VARCHAR(64) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_memberships_scope ON `memberships` (`organization_id`);
CREATE INDEX idx_memberships_scope_created ON `memberships` (`organization_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_memberships_scope_handle ON `memberships` (`organization_id`, `handle`);
CREATE TABLE IF NOT EXISTS `memberships_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_memberships_tl ON `memberships_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `roles` (
  `id` VARCHAR(64) NOT NULL,
  `organization_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `store_id` VARCHAR(64) NULL,
  `category` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` MEDIUMTEXT NULL,
  `permissions` JSON NULL,
  `system` TINYINT(1) NULL,
  `grants_approval` TINYINT(1) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_roles_scope ON `roles` (`organization_id`);
CREATE INDEX idx_roles_scope_created ON `roles` (`organization_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_roles_scope_handle ON `roles` (`organization_id`, `handle`);
CREATE TABLE IF NOT EXISTS `roles_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_roles_tl ON `roles_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `role_assignments` (
  `id` VARCHAR(64) NOT NULL,
  `organization_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `user_id` VARCHAR(64) NULL,
  `role_id` VARCHAR(64) NULL,
  `store_id` VARCHAR(64) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_role_assignments_scope ON `role_assignments` (`organization_id`);
CREATE INDEX idx_role_assignments_scope_created ON `role_assignments` (`organization_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_role_assignments_scope_handle ON `role_assignments` (`organization_id`, `handle`);
CREATE TABLE IF NOT EXISTS `role_assignments_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_role_assignments_tl ON `role_assignments_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `products` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` MEDIUMTEXT NULL,
  `status` VARCHAR(64) NULL,
  `vendor` VARCHAR(255) NULL,
  `product_type` VARCHAR(255) NULL,
  `sku` VARCHAR(255) NULL,
  `price_amount_minor` BIGINT NULL,
  `price_currency` CHAR(3) NULL,
  `compare_at_price_amount_minor` BIGINT NULL,
  `compare_at_price_currency` CHAR(3) NULL,
  `cost_per_item_amount_minor` BIGINT NULL,
  `cost_per_item_currency` CHAR(3) NULL,
  `inventory_quantity` INT NULL,
  `option_names` JSON NULL,
  `category_id` VARCHAR(64) NULL,
  `published_channels` JSON NULL,
  `internal_notes` MEDIUMTEXT NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_products_scope ON `products` (`store_id`);
CREATE INDEX idx_products_scope_created ON `products` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_products_scope_handle ON `products` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `products_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_products_mf ON `products_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `products_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_products_tag ON `products_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `products_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_products_tl ON `products_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `products_translations` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `field` VARCHAR(255) NOT NULL,
  `locale` VARCHAR(35) NOT NULL,
  `value` MEDIUMTEXT NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `outdated` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_products_tr ON `products_translations` (`store_id`, `owner_id`, `field`, `locale`);
CREATE TABLE IF NOT EXISTS `products_seo` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NULL,
  `description` MEDIUMTEXT NULL,
  `canonical_url` VARCHAR(1024) NULL,
  `og_image_url` VARCHAR(1024) NULL,
  `no_index` TINYINT(1) NOT NULL DEFAULT 0,
  `no_follow` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_products_seo ON `products_seo` (`store_id`, `owner_id`);
CREATE TABLE IF NOT EXISTS `products_saved_views` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `query` MEDIUMTEXT NULL,
  `sort` VARCHAR(255) NULL,
  `columns` JSON NULL,
  `shared` TINYINT(1) NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_products_sv ON `products_saved_views` (`store_id`, `position`);
CREATE TABLE IF NOT EXISTS `collections` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` MEDIUMTEXT NULL,
  `type` VARCHAR(64) NULL,
  `match` VARCHAR(64) NULL,
  `conditions` JSON NULL,
  `exclusions` JSON NULL,
  `product_ids` JSON NULL,
  `sort_order` VARCHAR(64) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_collections_scope ON `collections` (`store_id`);
CREATE INDEX idx_collections_scope_created ON `collections` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_collections_scope_handle ON `collections` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `collections_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_collections_mf ON `collections_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `collections_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_collections_tag ON `collections_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `collections_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_collections_tl ON `collections_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `collections_translations` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `field` VARCHAR(255) NOT NULL,
  `locale` VARCHAR(35) NOT NULL,
  `value` MEDIUMTEXT NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `outdated` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_collections_tr ON `collections_translations` (`store_id`, `owner_id`, `field`, `locale`);
CREATE TABLE IF NOT EXISTS `collections_seo` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NULL,
  `description` MEDIUMTEXT NULL,
  `canonical_url` VARCHAR(1024) NULL,
  `og_image_url` VARCHAR(1024) NULL,
  `no_index` TINYINT(1) NOT NULL DEFAULT 0,
  `no_follow` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_collections_seo ON `collections_seo` (`store_id`, `owner_id`);
CREATE TABLE IF NOT EXISTS `collections_saved_views` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `query` MEDIUMTEXT NULL,
  `sort` VARCHAR(255) NULL,
  `columns` JSON NULL,
  `shared` TINYINT(1) NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_collections_sv ON `collections_saved_views` (`store_id`, `position`);
CREATE TABLE IF NOT EXISTS `product_variants` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `product_id` VARCHAR(64) NULL,
  `sku` VARCHAR(255) NULL,
  `option_values` JSON NULL,
  `price_amount_minor` BIGINT NULL,
  `price_currency` CHAR(3) NULL,
  `compare_at_price_amount_minor` BIGINT NULL,
  `compare_at_price_currency` CHAR(3) NULL,
  `inventory_quantity` INT NULL,
  `position` INT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_product_variants_scope ON `product_variants` (`store_id`);
CREATE INDEX idx_product_variants_scope_created ON `product_variants` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_product_variants_scope_handle ON `product_variants` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `product_variants_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_product_variants_mf ON `product_variants_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `product_variants_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_product_variants_tag ON `product_variants_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `product_variants_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_product_variants_tl ON `product_variants_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `pages` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` MEDIUMTEXT NULL,
  `status` VARCHAR(64) NULL,
  `template_suffix` VARCHAR(255) NULL,
  `published_at` DATETIME(3) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_pages_scope ON `pages` (`store_id`);
CREATE INDEX idx_pages_scope_created ON `pages` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_pages_scope_handle ON `pages` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `pages_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_pages_mf ON `pages_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `pages_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_pages_tag ON `pages_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `pages_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_pages_tl ON `pages_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `pages_translations` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `field` VARCHAR(255) NOT NULL,
  `locale` VARCHAR(35) NOT NULL,
  `value` MEDIUMTEXT NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `outdated` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_pages_tr ON `pages_translations` (`store_id`, `owner_id`, `field`, `locale`);
CREATE TABLE IF NOT EXISTS `pages_seo` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NULL,
  `description` MEDIUMTEXT NULL,
  `canonical_url` VARCHAR(1024) NULL,
  `og_image_url` VARCHAR(1024) NULL,
  `no_index` TINYINT(1) NOT NULL DEFAULT 0,
  `no_follow` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_pages_seo ON `pages_seo` (`store_id`, `owner_id`);
CREATE TABLE IF NOT EXISTS `pages_saved_views` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `query` MEDIUMTEXT NULL,
  `sort` VARCHAR(255) NULL,
  `columns` JSON NULL,
  `shared` TINYINT(1) NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_pages_sv ON `pages_saved_views` (`store_id`, `position`);
CREATE TABLE IF NOT EXISTS `metaobject_definitions` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `type` VARCHAR(255) NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` MEDIUMTEXT NULL,
  `fields` JSON NULL,
  `display_name_key` VARCHAR(255) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_metaobject_definitions_scope ON `metaobject_definitions` (`store_id`);
CREATE INDEX idx_metaobject_definitions_scope_created ON `metaobject_definitions` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_metaobject_definitions_scope_handle ON `metaobject_definitions` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `metaobject_definitions_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_metaobject_definitions_tl ON `metaobject_definitions_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `metaobject_entries` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `definition_id` VARCHAR(64) NULL,
  `values` JSON NULL,
  `status` VARCHAR(64) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_metaobject_entries_scope ON `metaobject_entries` (`store_id`);
CREATE INDEX idx_metaobject_entries_scope_created ON `metaobject_entries` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_metaobject_entries_scope_handle ON `metaobject_entries` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `metaobject_entries_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_metaobject_entries_tag ON `metaobject_entries_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `metaobject_entries_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_metaobject_entries_tl ON `metaobject_entries_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `metaobject_entries_translations` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `field` VARCHAR(255) NOT NULL,
  `locale` VARCHAR(35) NOT NULL,
  `value` MEDIUMTEXT NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `outdated` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_metaobject_entries_tr ON `metaobject_entries_translations` (`store_id`, `owner_id`, `field`, `locale`);
CREATE TABLE IF NOT EXISTS `metaobject_entries_saved_views` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `query` MEDIUMTEXT NULL,
  `sort` VARCHAR(255) NULL,
  `columns` JSON NULL,
  `shared` TINYINT(1) NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_metaobject_entries_sv ON `metaobject_entries_saved_views` (`store_id`, `position`);
CREATE TABLE IF NOT EXISTS `customers` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `first_name` VARCHAR(255) NULL,
  `last_name` VARCHAR(255) NULL,
  `email` VARCHAR(255) NULL,
  `phone` VARCHAR(255) NULL,
  `state` VARCHAR(64) NULL,
  `email_consent` VARCHAR(64) NULL,
  `sms_consent` VARCHAR(64) NULL,
  `locale` VARCHAR(255) NULL,
  `tax_exempt` TINYINT(1) NULL,
  `orders_count` INT NULL,
  `total_spent_amount_minor` BIGINT NULL,
  `total_spent_currency` CHAR(3) NULL,
  `default_address` JSON NULL,
  `note` MEDIUMTEXT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_customers_scope ON `customers` (`store_id`);
CREATE INDEX idx_customers_scope_created ON `customers` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_customers_scope_handle ON `customers` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `customers_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_customers_mf ON `customers_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `customers_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_customers_tag ON `customers_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `customers_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_customers_tl ON `customers_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `customers_saved_views` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `query` MEDIUMTEXT NULL,
  `sort` VARCHAR(255) NULL,
  `columns` JSON NULL,
  `shared` TINYINT(1) NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_customers_sv ON `customers_saved_views` (`store_id`, `position`);
CREATE TABLE IF NOT EXISTS `customer_segments` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `name` VARCHAR(255) NOT NULL,
  `match` VARCHAR(64) NULL,
  `conditions` JSON NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_customer_segments_scope ON `customer_segments` (`store_id`);
CREATE INDEX idx_customer_segments_scope_created ON `customer_segments` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_customer_segments_scope_handle ON `customer_segments` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `customer_segments_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_customer_segments_tl ON `customer_segments_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `locations` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `name` VARCHAR(255) NOT NULL,
  `address` MEDIUMTEXT NULL,
  `country_code` VARCHAR(255) NOT NULL,
  `fulfils_orders` TINYINT(1) NULL,
  `archived_at` DATETIME(3) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_locations_scope ON `locations` (`store_id`);
CREATE INDEX idx_locations_scope_created ON `locations` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_locations_scope_handle ON `locations` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `locations_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_locations_mf ON `locations_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `locations_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_locations_tag ON `locations_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `locations_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_locations_tl ON `locations_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `inventory_levels` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `location_id` VARCHAR(64) NULL,
  `product_id` VARCHAR(64) NULL,
  `variant_id` VARCHAR(64) NULL,
  `title` VARCHAR(255) NULL,
  `sku` VARCHAR(255) NULL,
  `on_hand` INT NULL,
  `committed` INT NULL,
  `incoming` INT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_inventory_levels_scope ON `inventory_levels` (`store_id`);
CREATE INDEX idx_inventory_levels_scope_created ON `inventory_levels` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_inventory_levels_scope_handle ON `inventory_levels` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `inventory_levels_saved_views` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `query` MEDIUMTEXT NULL,
  `sort` VARCHAR(255) NULL,
  `columns` JSON NULL,
  `shared` TINYINT(1) NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_inventory_levels_sv ON `inventory_levels_saved_views` (`store_id`, `position`);
CREATE TABLE IF NOT EXISTS `inventory_adjustments` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `location_id` VARCHAR(64) NULL,
  `product_id` VARCHAR(64) NULL,
  `variant_id` VARCHAR(64) NULL,
  `delta` INT NULL,
  `reason` VARCHAR(64) NULL,
  `reference` VARCHAR(255) NULL,
  `occurred_at` DATETIME(3) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_inventory_adjustments_scope ON `inventory_adjustments` (`store_id`);
CREATE INDEX idx_inventory_adjustments_scope_created ON `inventory_adjustments` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_inventory_adjustments_scope_handle ON `inventory_adjustments` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `reference` VARCHAR(255) NULL,
  `supplier_name` VARCHAR(255) NOT NULL,
  `destination_location_id` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  `expected_at` DATETIME(3) NULL,
  `lines` JSON NULL,
  `line_count` INT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_purchase_orders_scope ON `purchase_orders` (`store_id`);
CREATE INDEX idx_purchase_orders_scope_created ON `purchase_orders` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_purchase_orders_scope_handle ON `purchase_orders` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `purchase_orders_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_purchase_orders_mf ON `purchase_orders_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `purchase_orders_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_purchase_orders_tag ON `purchase_orders_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `purchase_orders_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_purchase_orders_tl ON `purchase_orders_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `purchase_order_lines` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `purchase_order_id` VARCHAR(64) NULL,
  `product_id` VARCHAR(64) NULL,
  `variant_id` VARCHAR(64) NULL,
  `title` VARCHAR(255) NULL,
  `ordered` INT NULL,
  `received` INT NULL,
  `position` INT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_purchase_order_lines_scope ON `purchase_order_lines` (`store_id`);
CREATE INDEX idx_purchase_order_lines_scope_created ON `purchase_order_lines` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_purchase_order_lines_scope_handle ON `purchase_order_lines` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `transfers` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `reference` VARCHAR(255) NULL,
  `origin_location_id` VARCHAR(64) NULL,
  `destination_location_id` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  `lines` JSON NULL,
  `line_count` INT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_transfers_scope ON `transfers` (`store_id`);
CREATE INDEX idx_transfers_scope_created ON `transfers` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_transfers_scope_handle ON `transfers` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `transfers_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_transfers_mf ON `transfers_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `transfers_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_transfers_tag ON `transfers_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `transfers_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_transfers_tl ON `transfers_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `transfer_lines` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `transfer_id` VARCHAR(64) NULL,
  `product_id` VARCHAR(64) NULL,
  `variant_id` VARCHAR(64) NULL,
  `title` VARCHAR(255) NULL,
  `quantity` INT NULL,
  `received_quantity` INT NULL,
  `position` INT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_transfer_lines_scope ON `transfer_lines` (`store_id`);
CREATE INDEX idx_transfer_lines_scope_created ON `transfer_lines` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_transfer_lines_scope_handle ON `transfer_lines` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `requests` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `reference` VARCHAR(255) NULL,
  `customer_id` VARCHAR(64) NULL,
  `contact_email` VARCHAR(255) NULL,
  `contact_name` VARCHAR(255) NULL,
  `status` VARCHAR(64) NULL,
  `currency` VARCHAR(255) NULL,
  `line_count` INT NULL,
  `subtotal_amount_minor` BIGINT NULL,
  `subtotal_currency` CHAR(3) NULL,
  `note` MEDIUMTEXT NULL,
  `internal_note` MEDIUMTEXT NULL,
  `quote_expires_at` DATETIME(3) NULL,
  `submitted_at` DATETIME(3) NULL,
  `responded_at` DATETIME(3) NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_requests_scope ON `requests` (`store_id`);
CREATE INDEX idx_requests_scope_created ON `requests` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_requests_scope_handle ON `requests` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `requests_metafields` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `definition_id` VARCHAR(64) NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `metafield_key` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(255) NOT NULL,
  `value` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_requests_mf ON `requests_metafields` (`store_id`, `owner_id`, `namespace`, `metafield_key`);
CREATE TABLE IF NOT EXISTS `requests_tags` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `tag` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE UNIQUE INDEX uq_requests_tag ON `requests_tags` (`store_id`, `owner_id`, `tag`);
CREATE TABLE IF NOT EXISTS `requests_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_requests_tl ON `requests_timeline` (`store_id`, `owner_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `requests_saved_views` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `query` MEDIUMTEXT NULL,
  `sort` VARCHAR(255) NULL,
  `columns` JSON NULL,
  `shared` TINYINT(1) NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_requests_sv ON `requests_saved_views` (`store_id`, `position`);
CREATE TABLE IF NOT EXISTS `request_lines` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `handle` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INT NOT NULL DEFAULT 1,
  `deleted_at` DATETIME(3) NULL,
  `request_id` VARCHAR(64) NULL,
  `product_id` VARCHAR(64) NULL,
  `variant_id` VARCHAR(64) NULL,
  `title` VARCHAR(255) NULL,
  `sku` VARCHAR(255) NULL,
  `quantity` INT NULL,
  `list_price_amount_minor` BIGINT NULL,
  `list_price_currency` CHAR(3) NULL,
  `quoted_price_amount_minor` BIGINT NULL,
  `quoted_price_currency` CHAR(3) NULL,
  `position` INT NULL,
  `note` MEDIUMTEXT NULL,
  `published_channels` JSON NULL,
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_request_lines_scope ON `request_lines` (`store_id`);
CREATE INDEX idx_request_lines_scope_created ON `request_lines` (`store_id`, `created_at`, `id`);
CREATE UNIQUE INDEX uq_request_lines_scope_handle ON `request_lines` (`store_id`, `handle`);
CREATE TABLE IF NOT EXISTS `request_lines_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `store_id` VARCHAR(64) NOT NULL,
  `owner_id` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_label` VARCHAR(255) NOT NULL,
  `message` MEDIUMTEXT NOT NULL,
  `changes` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
CREATE INDEX idx_request_lines_tl ON `request_lines_timeline` (`store_id`, `owner_id`, `created_at`);
