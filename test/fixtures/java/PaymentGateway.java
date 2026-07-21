package com.example.payments;

/**
 * Contract implemented by all payment providers.
 */
public interface PaymentGateway {
    boolean charge(String accountId, long amountCents);
    void refund(String transactionId);
}

enum PaymentStatus {
    PENDING,
    COMPLETED,
    FAILED
}
