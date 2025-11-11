(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-trait-ft-standard.sip-010-trait)

(define-fungible-token micro-token u1000000000000000)

(define-data-var admin principal tx-sender)
(define-data-var total-supply-cap uint u1000000000000000)
(define-data-var paused bool false)
(define-data-var mint-paused bool false)
(define-data-var burn-paused bool false)

(define-map authorized-minters { budget-id: uint } principal)
(define-map budget-supplies { budget-id: uint } uint)
(define-map token-approvals { sender: principal, spender: principal } uint)
(define-map transfer-memos { tx-hash: (buff 32) } (optional (buff 34)))

(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-PAUSED (err u101))
(define-constant ERR-MINT-PAUSED (err u102))
(define-constant ERR-BURN-PAUSED (err u103))
(define-constant ERR-SUPPLY-EXCEEDED (err u104))
(define-constant ERR-INVALID-BUDGET-ID (err u105))
(define-constant ERR-INSUFFICIENT-APPROVAL (err u106))
(define-constant ERR-ZERO-AMOUNT (err u107))
(define-constant ERR-INVALID-MINTER (err u108))
(define-constant ERR-TRANSFER-FAILED (err u109))

(define-read-only (get-name)
  (ok "MicroBudgetToken")
)

(define-read-only (get-symbol)
  (ok "MBT")
)

(define-read-only (get-decimals)
  (ok u6)
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance micro-token account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply micro-token))
)

(define-read-only (get-allowance (owner principal) (spender principal))
  (ok (default-to u0 (map-get? token-approvals { sender: owner, spender: spender })))
)

(define-read-only (get-budget-supply (budget-id uint))
  (ok (default-to u0 (map-get? budget-supplies { budget-id: budget-id })))
)

(define-read-only (is-authorized-minter (budget-id uint) (minter principal))
  (let ((minter-opt (map-get? authorized-minters { budget-id: budget-id })))
    (ok (match minter-opt m (is-eq m minter) false)))
)

(define-read-only (is-paused)
  (ok (var-get paused))
)

(define-read-only (is-mint-paused)
  (ok (var-get mint-paused))
)

(define-read-only (is-burn-paused)
  (ok (var-get burn-paused))
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (var-set admin new-admin)
    (ok true)
  )
)

(define-public (set-pause (new-paused bool))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (var-set paused new-paused)
    (ok true)
  )
)

(define-public (set-mint-pause (new-mint-paused bool))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (var-set mint-paused new-mint-paused)
    (ok true)
  )
)

(define-public (set-burn-pause (new-burn-paused bool))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (var-set burn-paused new-burn-paused)
    (ok true)
  )
)

(define-public (set-supply-cap (new-cap uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (asserts! (>= new-cap (ft-get-supply micro-token)) ERR-SUPPLY-EXCEEDED)
    (var-set total-supply-cap new-cap)
    (ok true)
  )
)

(define-public (authorize-minter (budget-id uint) (minter principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (asserts! (not (is-eq budget-id u0)) ERR-INVALID-BUDGET-ID)
    (map-set authorized-minters { budget-id: budget-id } minter)
    (ok true)
  )
)

(define-public (deauthorize-minter (budget-id uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (map-delete authorized-minters { budget-id: budget-id })
    (ok true)
  )
)

(define-public (mint (budget-id uint) (amount uint) (recipient principal))
  (let
    (
      (current-supply (ft-get-supply micro-token))
      (minter-opt (map-get? authorized-minters { budget-id: budget-id }))
      (new-supply (+ current-supply amount))
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (not (var-get mint-paused)) ERR-MINT-PAUSED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (asserts! (<= new-supply (var-get total-supply-cap)) ERR-SUPPLY-EXCEEDED)
    (match minter-opt
      m (asserts! (is-eq tx-sender m) ERR-INVALID-MINTER)
      (err ERR-INVALID-MINTER))
    (let
      (
        (current-budget-supply (default-to u0 (map-get? budget-supplies { budget-id: budget-id })))
        (updated-budget-supply (+ current-budget-supply amount))
      )
      (map-set budget-supplies { budget-id: budget-id } updated-budget-supply)
      (ft-mint? micro-token amount recipient)
    )
  )
)

(define-public (burn (budget-id uint) (amount uint) (from principal))
  (let
    (
      (current-supply (ft-get-supply micro-token))
      (new-supply (- current-supply amount))
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (not (var-get burn-paused)) ERR-BURN-PAUSED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (asserts! (>= (ft-get-balance micro-token from) amount) ERR-TRANSFER-FAILED)
    (let
      (
        (current-budget-supply (default-to u0 (map-get? budget-supplies { budget-id: budget-id })))
        (updated-budget-supply (- current-budget-supply amount))
      )
      (asserts! (>= current-budget-supply amount) ERR-SUPPLY-EXCEEDED)
      (map-set budget-supplies { budget-id: budget-id } updated-budget-supply)
      (ft-burn? micro-token amount from)
    )
  )
)

(define-public (transfer (to principal) (amount uint) (memo (optional (buff 34))))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (asserts! (not (is-eq tx-sender to)) ERR-ZERO-AMOUNT)
    (asserts! (>= (ft-get-balance micro-token tx-sender) amount) ERR-TRANSFER-FAILED)
    (let
      (
        (tx-hash (sha256 (concat (to-consensus-buff? tx-sender) (to-consensus-buff? (unwrap-panic (get-block-info? time block-height))))))
      )
      (map-set transfer-memos { tx-hash: tx-hash } memo)
      (ft-transfer? micro-token amount tx-sender to)
    )
  )
)

(define-public (transfer-from (from principal) (to principal) (amount uint))
  (let
    (
      (allowed (default-to u0 (map-get? token-approvals { sender: from, spender: tx-sender })))
      (balance-from (ft-get-balance micro-token from))
      (new-allowed (- allowed amount))
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (asserts! (not (is-eq from to)) ERR-ZERO-AMOUNT)
    (asserts! (>= balance-from amount) ERR-TRANSFER-FAILED)
    (asserts! (>= allowed amount) ERR-INSUFFICIENT-APPROVAL)
    (map-set token-approvals { sender: from, spender: tx-sender } new-allowed)
    (ft-transfer? micro-token amount from to)
  )
)

(define-public (approve (spender principal) (amount uint))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (map-set token-approvals { sender: tx-sender, spender: spender } amount)
    (ok true)
  )
)

(define-public (increase-allowance (spender principal) (added-value uint))
  (let
    (
      (current-allowed (default-to u0 (map-get? token-approvals { sender: tx-sender, spender: spender })))
      (new-allowed (+ current-allowed added-value))
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (> added-value u0) ERR-ZERO-AMOUNT)
    (map-set token-approvals { sender: tx-sender, spender: spender } new-allowed)
    (ok true)
  )
)

(define-public (decrease-allowance (spender principal) (subtracted-value uint))
  (let
    (
      (current-allowed (default-to u0 (map-get? token-approvals { sender: tx-sender, spender: spender })))
      (new-allowed (- current-allowed subtracted-value))
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (> subtracted-value u0) ERR-ZERO-AMOUNT)
    (asserts! (>= current-allowed subtracted-value) ERR-INSUFFICIENT-APPROVAL)
    (map-set token-approvals { sender: tx-sender, spender: spender } new-allowed)
    (ok true)
  )
)

(define-read-only (get-transfer-memo (tx-hash (buff 32)))
  (map-get? transfer-memos { tx-hash: tx-hash })
)