CREATE OR REPLACE FUNCTION enforce_balanced_financial_ledger_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_group UUID;
  currency_code CHAR(3);
  debit_total NUMERIC;
  credit_total NUMERIC;
BEGIN
  target_group := NEW.entry_group_id;

  FOR currency_code IN
    SELECT DISTINCT currency
    FROM financial_ledger_entries
    WHERE entry_group_id = target_group
  LOOP
    SELECT
      COALESCE(SUM(amount_minor) FILTER (WHERE direction::text = 'DEBIT'), 0),
      COALESCE(SUM(amount_minor) FILTER (WHERE direction::text = 'CREDIT'), 0)
    INTO debit_total, credit_total
    FROM financial_ledger_entries
    WHERE entry_group_id = target_group
      AND currency = currency_code;

    IF debit_total <> credit_total THEN
      RAISE EXCEPTION
        'Financial ledger group % is not balanced for currency % (debits %, credits %)',
        target_group, currency_code, debit_total, credit_total
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER financial_ledger_group_balanced
AFTER INSERT ON financial_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_balanced_financial_ledger_group();
