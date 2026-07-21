package com.example.calc;

/**
 * A simple calculator supporting basic arithmetic with a running total.
 */
public class Calculator {

    private double total;

    public Calculator() {
        this.total = 0;
    }

    /**
     * Adds a value to the running total and returns the new total.
     */
    public double add(double value) {
        this.total += value;
        return this.total;
    }

    public double subtract(double value) {
        this.total -= value;
        return this.total;
    }

    private double applyRounding(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    public double getTotal() {
        return applyRounding(this.total);
    }
}
