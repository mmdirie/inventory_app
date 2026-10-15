# Financial report definitions

The financial summary reports recorded sales revenue, recorded purchases, recorded expenses, collections, disbursements, and outstanding debts. It does not report net profit.

The database stores each sale's selling price, but does not snapshot the inventory cost at the time of sale. The product purchase price is mutable and may only reflect a later purchase, so subtracting purchases from sales is not a valid cost-of-goods-sold calculation. The API therefore returns `profit: null`, `profit_status: "unavailable"`, and a reason rather than a profit-shaped estimate.

The inventory report's `estimated_current_inventory_price_spread` is only the difference between current selling and purchase prices multiplied by current stock. It is not realized profit, excludes operating expenses and sales timing, and must not be interpreted as cost of goods sold or business profitability.

A reliable future profit calculation should store a cost basis on each sale line at sale time and use a documented inventory valuation method (for example, perpetual weighted-average cost). Returns must reverse the cost basis from their original sale lines. Historical rows without such a snapshot must remain excluded or explicitly estimated; they must not be assigned invented costs.
