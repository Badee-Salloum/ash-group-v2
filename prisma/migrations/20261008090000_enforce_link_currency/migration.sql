-- Install transactions_matchedTxId_idx CONCURRENTLY before this migration.
SET lock_timeout = '5s';
CREATE OR REPLACE FUNCTION enforce_transaction_link_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row RECORD; other_row RECORD; currency_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."matchedTxId" IS NULL THEN RETURN NULL; END IF;
    currency_changed := FALSE;
  ELSE
    currency_changed := upper(btrim(OLD.currency)) IS DISTINCT FROM upper(btrim(NEW.currency));
    IF NOT currency_changed AND OLD."matchedTxId" IS NOT DISTINCT FROM NEW."matchedTxId" THEN RETURN NULL; END IF;
  END IF;
  -- Read final state, so atomic relinks / changing both currencies in the
  -- same transaction are checked at commit rather than at an intermediate row.
  SELECT id, currency, "matchedTxId" INTO current_row FROM transactions WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOR other_row IN
    SELECT id, currency FROM transactions
    WHERE id = current_row."matchedTxId"
       OR (currency_changed AND "matchedTxId" = current_row.id)
    ORDER BY id FOR SHARE
  LOOP
    IF nullif(btrim(current_row.currency), '') IS NULL
       OR nullif(btrim(other_row.currency), '') IS NULL
       OR upper(btrim(current_row.currency)) <> upper(btrim(other_row.currency)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'transactions_matched_currency_check',
        MESSAGE = 'Cannot link transactions with different or missing currencies';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transactions_matched_currency_check
AFTER INSERT OR UPDATE ON transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_transaction_link_currency();
RESET lock_timeout;
