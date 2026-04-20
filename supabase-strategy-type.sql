-- Allow 'strategy' as a content type so Strategy Vault can save into the existing content table
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_type_check;
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_type_check;
ALTER TABLE content ADD CONSTRAINT content_type_check CHECK (type IN ('short','long','both','strategy'));
