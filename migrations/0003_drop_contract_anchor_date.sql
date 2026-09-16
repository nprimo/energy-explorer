-- 0003_drop_contract_anchor_date.sql
-- docs/contract-invoice-plan.md Rev 3: there are no invoice periods — costs
-- are computed pre-tax over any analysis range, so the contract no longer
-- needs an anchor date (its only purpose was deriving monthly billing
-- windows). Fresh databases created after 0002 keep the column only until
-- this migration drops it; existing databases (0002 already applied) lose it
-- here. Either way the end state is a contracts table without it.

ALTER TABLE contracts DROP COLUMN contract_anchor_date;
