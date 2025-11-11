(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-BUDGET-ID u101)
(define-constant ERR-INSUFFICIENT-FUNDS u102)
(define-constant ERR-INVALID-AMOUNT u103)
(define-constant ERR-BUDGET-ALREADY-EXISTS u104)
(define-constant ERR-BUDGET-NOT-FOUND u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u107)
(define-constant ERR-INVALID-MAX-BUDGETS u108)
(define-constant ERR-INVALID-FEE u109)
(define-constant ERR-INVALID-STATUS u110)
(define-constant ERR-INVALID-CURRENCY u111)
(define-constant ERR-INVALID-LOCATION u112)
(define-constant ERR-INVALID-BUDGET-TYPE u113)
(define-constant ERR-MAX-BUDGETS-EXCEEDED u114)
(define-constant ERR-INVALID-WITHDRAWAL u115)
(define-constant ERR-PAUSED u116)
(define-data-var next-budget-id uint u0)
(define-data-var max-budgets uint u500)
(define-data-var creation-fee uint u500)
(define-data-var authority-contract (optional principal) none)
(define-map budgets
  uint
  {
    name: (string-utf8 100),
    total-locked: uint,
    currency: (string-utf8 20),
    location: (string-utf8 100),
    budget-type: (string-utf8 50),
    status: bool,
    timestamp: uint,
    creator: principal,
    admin: principal
  }
)
(define-map budget-balances
  { budget-id: uint }
  uint
)
(define-map budget-updates
  uint
  {
    update-name: (string-utf8 100),
    update-admin: principal,
    update-timestamp: uint,
    updater: principal
  }
)
(define-map budget-audits
  { budget-id: uint, tx-id: (buff 32) }
  {
    amount: uint,
    action: (string-utf8 50),
    recipient: principal,
    timestamp: uint
  }
)
(define-read-only (get-budget (id uint))
  (map-get? budgets id)
)
(define-read-only (get-budget-balance (budget-id uint))
  (map-get? budget-balances { budget-id: budget-id })
)
(define-read-only (get-budget-updates (id uint))
  (map-get? budget-updates id)
)
(define-read-only (get-budget-audit (budget-id uint) (tx-id (buff 32)))
  (map-get? budget-audits { budget-id: budget-id, tx-id: tx-id })
)
(define-read-only (is-budget-registered (name (string-utf8 100)))
  (let ((budget-id (map-get? budgets-by-name name)))
    (is-some budget-id)
  )
)
(define-private (validate-name (name (string-utf8 100)))
  (if (and (> (len name) u0) (<= (len name) u100))
      (ok true)
      (err ERR-INVALID-BUDGET-ID))
)
(define-private (validate-amount (amount uint))
  (if (> amount u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)
(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)
(define-private (validate-currency (cur (string-utf8 20)))
  (if (or (is-eq cur "STX") (is-eq cur "USD") (is-eq cur "BTC"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)
(define-private (validate-location (loc (string-utf8 100)))
  (if (and (> (len loc) u0) (<= (len loc) u100))
      (ok true)
      (err ERR-INVALID-LOCATION))
)
(define-private (validate-budget-type (type (string-utf8 50)))
  (if (or (is-eq type "government") (is-eq type "ngo") (is-eq type "corporate"))
      (ok true)
      (err ERR-INVALID-BUDGET-TYPE))
)
(define-private (validate-status (s bool))
  (ok true)
)
(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)
(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)
(define-public (set-max-budgets (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-MAX-BUDGETS))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-budgets new-max)
    (ok true)
  )
)
(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-FEE))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)
(define-public (create-budget
  (budget-name (string-utf8 100))
  (currency (string-utf8 20))
  (location (string-utf8 100))
  (budget-type (string-utf8 50))
  (admin principal)
)
  (let (
        (next-id (var-get next-budget-id))
        (current-max (var-get max-budgets))
        (authority (var-get authority-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-BUDGETS-EXCEEDED))
    (try! (validate-name budget-name))
    (try! (validate-currency currency))
    (try! (validate-location location))
    (try! (validate-budget-type budget-type))
    (try! (validate-status true))
    (asserts! (is-none (map-get? budgets next-id)) (err ERR-BUDGET-ALREADY-EXISTS))
    (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get creation-fee) tx-sender authority-recipient))
    )
    (map-set budgets next-id
      {
        name: budget-name,
        total-locked: u0,
        currency: currency,
        location: location,
        budget-type: budget-type,
        status: true,
        timestamp: block-height,
        creator: tx-sender,
        admin: admin
      }
    )
    (map-insert budget-balances { budget-id: next-id } u0)
    (var-set next-budget-id (+ next-id u1))
    (print { event: "budget-created", id: next-id })
    (ok next-id)
  )
)
(define-public (lock-funds (budget-id uint) (amount uint))
  (let ((budget (map-get? budgets budget-id))
        (current-balance (default-to u0 (map-get? budget-balances { budget-id: budget-id }))))
    (match budget
      b
        (begin
          (asserts! (get status b) (err ERR-PAUSED))
          (try! (validate-amount amount))
          (asserts! (>= (stx-get-balance tx-sender) amount) (err ERR-INSUFFICIENT-FUNDS))
          (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
          (let ((new-balance (+ current-balance amount)))
            (map-set budget-balances { budget-id: budget-id } new-balance)
            (map-set budgets budget-id
              {
                name: (get name b),
                total-locked: new-balance,
                currency: (get currency b),
                location: (get location b),
                budget-type: (get budget-type b),
                status: (get status b),
                timestamp: (get timestamp b),
                creator: (get creator b),
                admin: (get admin b)
              }
            )
            (let ((tx-id (sha256 (concat (contract-caller) (to-consensus-buff? u64 (get-block-info? time block-height))))))
              (map-insert budget-audits { budget-id: budget-id, tx-id: tx-id }
                {
                  amount: amount,
                  action: "lock",
                  recipient: tx-sender,
                  timestamp: block-height
                }
              )
            )
            (print { event: "funds-locked", budget-id: budget-id, amount: amount })
            (ok new-balance)
          )
        )
      (err ERR-BUDGET-NOT-FOUND)
    )
  )
)
(define-public (withdraw-funds (budget-id uint) (amount uint) (recipient principal))
  (let ((budget (map-get? budgets budget-id))
        (current-balance (default-to u0 (map-get? budget-balances { budget-id: budget-id }))))
    (match budget
      b
        (begin
          (asserts! (is-eq (get admin b) tx-sender) (err ERR-NOT-AUTHORIZED))
          (asserts! (get status b) (err ERR-PAUSED))
          (try! (validate-amount amount))
          (asserts! (>= current-balance amount) (err ERR-INSUFFICIENT-FUNDS))
          (try! (as-contract (stx-transfer? amount (as-contract tx-sender) recipient)))
          (let ((new-balance (- current-balance amount)))
            (map-set budget-balances { budget-id: budget-id } new-balance)
            (map-set budgets budget-id
              {
                name: (get name b),
                total-locked: new-balance,
                currency: (get currency b),
                location: (get location b),
                budget-type: (get budget-type b),
                status: (get status b),
                timestamp: (get timestamp b),
                creator: (get creator b),
                admin: (get admin b)
              }
            )
            (let ((tx-id (sha256 (concat (contract-caller) (to-consensus-buff? u64 (get-block-info? time block-height))))))
              (map-insert budget-audits { budget-id: budget-id, tx-id: tx-id }
                {
                  amount: amount,
                  action: "withdraw",
                  recipient: recipient,
                  timestamp: block-height
                }
              )
            )
            (print { event: "funds-withdrawn", budget-id: budget-id, amount: amount })
            (ok new-balance)
          )
        )
      (err ERR-BUDGET-NOT-FOUND)
    )
  )
)
(define-public (update-budget-admin (budget-id uint) (new-admin principal))
  (let ((budget (map-get? budgets budget-id)))
    (match budget
      b
        (begin
          (asserts! (is-eq (get creator b) tx-sender) (err ERR-NOT-AUTHORIZED))
          (map-set budgets budget-id
            {
              name: (get name b),
              total-locked: (get total-locked b),
              currency: (get currency b),
              location: (get location b),
              budget-type: (get budget-type b),
              status: (get status b),
              timestamp: block-height,
              creator: (get creator b),
              admin: new-admin
            }
          )
          (map-set budget-updates budget-id
            {
              update-name: (get name b),
              update-admin: new-admin,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "budget-admin-updated", budget-id: budget-id })
          (ok true)
        )
      (err ERR-BUDGET-NOT-FOUND)
    )
  )
)
(define-public (pause-budget (budget-id uint))
  (let ((budget (map-get? budgets budget-id)))
    (match budget
      b
        (begin
          (asserts! (is-eq (get admin b) tx-sender) (err ERR-NOT-AUTHORIZED))
          (map-set budgets budget-id
            {
              name: (get name b),
              total-locked: (get total-locked b),
              currency: (get currency b),
              location: (get location b),
              budget-type: (get budget-type b),
              status: false,
              timestamp: (get timestamp b),
              creator: (get creator b),
              admin: (get admin b)
            }
          )
          (print { event: "budget-paused", budget-id: budget-id })
          (ok true)
        )
      (err ERR-BUDGET-NOT-FOUND)
    )
  )
)
(define-public (resume-budget (budget-id uint))
  (let ((budget (map-get? budgets budget-id)))
    (match budget
      b
        (begin
          (asserts! (is-eq (get admin b) tx-sender) (err ERR-NOT-AUTHORIZED))
          (map-set budgets budget-id
            {
              name: (get name b),
              total-locked: (get total-locked b),
              currency: (get currency b),
              location: (get location b),
              budget-type: (get budget-type b),
              status: true,
              timestamp: (get timestamp b),
              creator: (get creator b),
              admin: (get admin b)
            }
          )
          (print { event: "budget-resumed", budget-id: budget-id })
          (ok true)
        )
      (err ERR-BUDGET-NOT-FOUND)
    )
  )
)
(define-read-only (get-budget-count)
  (ok (var-get next-budget-id))
)
(define-read-only (check-budget-existence (name (string-utf8 100)))
  (let ((budget (map-get? budgets-by-name name)))
    (ok (is-some budget))
  )
)